# Couture Cast Learning Path (step by step)

Updated: 2026-10-31.
Added Steps 40 to 49:

- Step 40: Story 6.2b, community screening release gate and hosted worker, `abfdf88a` (PR #151).
- Step 41: Story 6.3, curated reactions, `989d1017` (PR #153).
- Step 42: Story 6.4, screened threaded comments, `aa8cd0e1` (PR #154).
- Step 43: Story 6.5, realtime engagement and push notifications, `4be0be64` (PR #157).
- Step 44: Story 6.6, community city spotlight, `1d4ad0c2` (PR #158).
- Step 45: Story 1.2b, client location capture, `27041941` (PR #159).
- Step 46: Story 6.7, Home spotlight teaser, `f7045a7b` (PR #160).
- Step 47: Story 6.7b, sponsored community highlights, `1d7b9848` (PR #161).
- Step 48: Story 6.8, safe branded share-card export, `67806196` (PR #162), with native-lane fixes `3112efbd` (PR #165) and `185e827c` (PR #166).
- Step 49: Story 6.9, native platform sharing, PR #167 at `37a00d33`, in review and unmerged.

Repository evidence was checked against `main` at `185e827c` and Step 49 against `origin/feat/cc69-native-platform-sharing` at `37a00d33`.
PR and CI status below describe the 2026-10-31 snapshot.
The source-comment follow-ups named in the new steps require a separate repository change.
Owner maps also include historical or descriptive labels whose exact source anchors need reconciliation.
The read-only review records those contract gaps under `Evidence boundaries`.

Step 49 departs from instruction 2 the same way Steps 38 and 39 did, and its `Evidence boundaries` section says what passed, what timed out, and what only a physical device can prove.
Moved Step 39 to completed, since PR #151 closed Story 6.2.
Corrected `Current position`, which said six of the eight Community Beta signatures stay open; the Story 6.2b payload lists seven.
Rewrote the whole document in plain voice, one sentence per line.

Earlier (2026-09-08): added Step 39 for Story 6.2, production content-screening readiness, from `feat/epic6-story2` (PR #144) while the story was `in-progress` and its test-architecture review was in flight.
It covers the bundled NSFW model, the supervised inference process, the seven-language text screener and the measurement payload Story 6.2b consumes.
Like Step 38, it departs from instruction 2 on purpose.
Its `Evidence boundaries` section names what is measured, what is reported, what the review had not yet returned, and the one required command that stays red until four platform majors move.
Moved Step 38 to completed after Story 6.1 merged as `0d7dab05` (PR #142) and `18f95595` (PR #143).

Earlier (2026-09-05): added Step 38 for Story 6.1, the community feed by climate band, from `feat/epic6-story1` while the story was `in-progress`.
It covers the `published_at,id` cursor, the API-only RLS posture, the fail-closed image screening that ends every post at `flagged`, both clients, and every test tier.
The session that owned the story asked for that departure from instruction 2, and Step 38's `Evidence boundaries` section says which numbers are counted and which are reported.
Also added Step 37 for Story 5.5, the premium 7-day outfit planner, from PR #141 (`f95c09fa`).
It includes the eight post-review fixes that PR #141's CI gates and burn-in forced: two contrast defects, a hydration mismatch, a shared enum leaking `null` into two unrelated endpoints, three coverage shortfalls, and the Expo Go developer sheet.
Corrected two stale claims in `Current position`, and a third in Step 36's test map, which said no workflow runs the integration tier.

Earlier (2026-08-26): added Step 36 for Story 5.4, the colour palette, beauty and accessory advisor, from the implemented and reviewed change.
Story 5.4 shipped both surfaces and all five test tiers, so Step 36's boundary is what no tier proves: real-world classification accuracy and the native camera path.
Step 35 kept its own boundary note: Story 5.3's mobile surface, Pact, Playwright and Maestro were cut for that pass and recorded in `deferred-work.md`.

Earlier (2026-08-19): added Step 35 for Story 5.3, the premium theme switcher.
Added searchable `Learning path Step` cross-link comments to every test file Step 35 lists, plus the five Step 34 files that change already touched.
The other Step 34 test files, all three mobile ones included, still carry no cross-link comment.

## Instructions for LLMs updating this file

This contract is authoritative.
Read it before changing or adding a numbered step.

1. Use Step 33 as the complete structural reference.
   Use Steps 25 through 32 and 40 through 48 as additional story-specific examples.
   Read the completed story artifact, review log, test evidence, and live implementation before writing the new step.
2. Do not turn a planned story into implementation lessons.
   A story with status `ready-for-dev` belongs in `Current position`.
   Add its numbered learning step only after implementation and review produce verified evidence.
3. Every numbered step must use this exact order:
   - `## Step N: Title`
   - `User/business impact:`
   - `Key takeaways:`
   - `Hard-won lessons from the implementation and code review of this story:` when verified lessons exist
   - `Story/Task mapping:`
   - `Story reference:`
   - `Cross-links:`
   - `Sequence to follow:`
   - `Task owner map:`
   - `Tests that cover this step:`
   - `Architecture diagram:` when a diagram materially improves understanding
4. Do not omit a required section because the source story used a different layout.
   Derive each section from repository evidence.
   If evidence is missing, state the evidence boundary.
5. Update the `Updated` line, `Current position`, and `The whole project in plain English` table in the same edit.
   Keep story statuses aligned with `_bmad-output/implementation-artifacts/sprint-status.yaml`.
6. Use exact repository paths and task numbers.
   Verify every referenced file exists.
   Preserve security rules, failure modes, numeric thresholds, and known verification gaps.
7. Keep `Key takeaways` focused on reusable architecture and product lessons.
   Put defects, review discoveries, flaky-test causes, and integration surprises under `Hard-won lessons`.
8. Treat tests as executable documentation.
   Group direct coverage by test level, link every test file, explain what it proves, and add a Step cross-link comment to every listed test file.
   When a step has no direct executable coverage, state that evidence boundary.
   Do not pad the map with indirect suites.
9. Run Markdown, owner-anchor, reference-path, and Mermaid checks after editing.
   Do not claim a check passed unless it ran successfully.

## How to use this

1. Read the project map below.
2. Jump to the step you need.
3. Read the story, then open the files in `Sequence to follow`.
4. Use `Task owner map` when you need the exact code location.
5. Use `Tests that cover this step` when you want executable examples of the behavior and its boundaries.

## Current position

- Latest completed step: Step 48, Story 6.8, Safe branded share-card export, status `done`, merged as `67806196` (PR #162) with native-lane fixes in `3112efbd` (PR #165) and `185e827c` (PR #166).
  Its plan is `_bmad-output/implementation-artifacts/spec-6-8-safe-branded-share-card-export.md`.
- In review: Step 49, Story 6.9, Native platform sharing, status `review` on its branch and `backlog` on `main`, PR #167 at `37a00d33`.
  PR checks pass at the reviewed head.
  [Dispatch run 41190704639](https://github.com/muratkeremozcan/couture-cast/actions/runs/41190704639) timed out in `android36-native-matrix` at its 60-minute step limit; the dependent `share-card-lanes-gate` also failed.
  Its plan is `_bmad-output/implementation-artifacts/spec-6-9-native-platform-sharing.md` on the branch.
  Step 49 is written before merge, and its `Evidence boundaries` section says so.
- Next in `backlog` under epic 6, which is `in-progress`: Stories 6.10 to 6.13 (moderator queue, moderation decisions and sanctions, SLA monitoring, immutable moderation history), 6.14 (complimentary full access) and 6.15 (Expo SDK 58 live font-scale layout).
- Step 47, Story 6.7b, Sponsored community highlights, status `done`, merged as `1d7b9848` (PR #161).
  Its plan is `_bmad-output/implementation-artifacts/spec-6-7b-sponsored-community-highlights.md`.
  Production stays dark because `commerce_affiliate_enabled` and both community flags default to false.
- Step 46, Story 6.7, Home spotlight teaser, status `done`, merged as `f7045a7b` (PR #160).
  Its plan is `_bmad-output/implementation-artifacts/spec-6-7-home-spotlight-teaser.md`.
  The sponsored CTA the epic first asked for moved to Story 6.7b (Step 47).
- Step 45, Story 1.2b, Client location capture, status `done`, merged as `27041941` (PR #159).
  Its plan is `_bmad-output/implementation-artifacts/spec-1-2b-client-location-capture.md`.
  `LOCATION_CANDIDATE_SECRET` on preview and production is recorded as an external prerequisite.
- Step 44, Story 6.6, Community city spotlight, status `done`, merged as `1d4ad0c2` (PR #158).
  Its plan is `_bmad-output/implementation-artifacts/spec-6-6-community-city-spotlight.md`.
  Both community rollout flags stay false.
- Step 43, Story 6.5, Realtime engagement and push notifications, status `done`, merged as `4be0be64` (PR #157).
  Production dispatch and both community flags stay off.
  Physical-device push and the hosted preview probe have not run.
- Step 42, Story 6.4, Screened threaded comments, status `done`, merged as `aa8cd0e1` (PR #154).
  Its plan is `_bmad-output/implementation-artifacts/spec-6-4-threaded-comments.md`.
  Held and blocked comments wait on the moderator Stories 6.10 and 6.11.
- Step 41, Story 6.3, Curated reactions, status `done`, merged as `989d1017` (PR #153).
  Reactions ship behind both community flags, which stay false.
  Story 6.6 inherits the per-post generation cache contract.
- Step 40, Story 6.2b, Community screening release gate and hosted worker, status `done`, merged as `abfdf88a` (PR #151).
  Story 6.2 emits the measurements and Story 6.2b renders the verdict.
  The verdict reads `fail` on the safe-photo and clean-caption holdouts, no signature is recorded, and both rollout flags stay false.
  Seven of the eight Community Beta signatures sit outside Story 6.2b and stay open: moderation staffing, SLA alerts, privacy, deletion, localization, accessibility and rollback.
- Step 39, Story 6.2, Production content-screening readiness, status `done`, merged as `1a678c51` (PR #144) and closed by PR #151.
  Its plan is `_bmad-output/implementation-artifacts/6-2-production-content-screening-readiness.md`.
  Five parallel sessions built it as one pull request of 78 files and roughly 19,000 insertions.
  Before merge the integrated tree was green on typecheck, repository-wide lint, `test:coverage` at 95.03 statements across 194 files, both screening verify commands, the gated real-model smoke suite at 9 of 9, `test:tagging-model:smoke`, and `test:pw-local` at 159 passed.
  Step 39 was written before its test-architecture review returned, and says so.
  It closed the largest boundary Step 38 named: every post terminated at `flagged` because ADR-013's NSFW model was missing from this repository.
- Step 38, Story 6.1, Community feed by climate band, status `done`, merged as `0d7dab05` (PR #142), with five review leftovers closed by `18f95595` (PR #143).
  Its plan is `_bmad-output/implementation-artifacts/6-1-community-feed-by-climate-band.md`, whose `Spec Change Log` records the thirteen decisions taken during remediation.
  Step 38 was written from the branch code before the story closed.
  Its suite totals come from one green `npm run validate` (392 files, 5,302 tests) plus one pass of each outer tier.
  Its `Evidence boundaries` section says which numbers the running sessions measured and which were counted from the repository.
  Production stays dark: `community_read_enabled` and `community_write_enabled` both default false, and the Community Beta gate needs eight signatures.
- Step 37, Story 5.5, Premium 7-day outfit planner, status `done`, merged as `f95c09fa` (PR #141).
  Its plan is `_bmad-output/implementation-artifacts/5-5-premium-7-day-outfit-planner.md`.
  All ten tasks shipped across both surfaces and every test tier.
  The pre-PR test-architecture review closed a real gap before merge: `planner.service.spec.ts` proved dependency-fingerprint invalidation for one of its five inputs, and now proves all five.
  Step 37's `Evidence boundaries` section names what no tier proves, starting with the manual VoiceOver and TalkBack passes nobody performed.
- Step 36, Story 5.4, Colour palette, beauty and accessory advisor, status `done`, on PR #140.
  Its plan is `_bmad-output/implementation-artifacts/5-4-color-palette-beauty-accessory-advisor.md`.
  All ten tasks are implemented and reviewed across both surfaces and all five test tiers.
  The same PR closed the closeable half of its deferred backlog: the stale-rules-version explanation, the advisor offer query-plan evidence, the garment click's untrusted dedupe key, and the three planning documents that had gone false about where face images are processed.
  Step 36's `Evidence boundaries` section names everything still unproven.
- Step 35, Story 5.3, Premium theme switcher, status `done`.
  The mobile surface landed in PR #137, and the Pact and Playwright coverage in PR #133.
  No Maestro flow covers the theme switcher.
- Open from Story 5.4: two CI-plumbing items in `deferred-work.md`, both needing a runner.
  Per-attempt Maestro artifacts is untouched.
  The Pact consumer flake reproduces on demand and carries a bounded retry from Story 5.5; its fix, an explicit port per interaction, is still open.
  Story 5.5 closed the third item, the `open-settings.yaml` emulator flake, with the shared `absorb-expo-dev-sheet.yaml` subflow.
- Corrected on 2026-10-31: this section said six of the eight Community Beta signatures stay open.
  The Story 6.2b payload's `communityBetaGate.remainOpen` lists seven.
- Corrected on 2026-09-08: this section listed the absent ADR-013 NSFW model as open backlog and said every community post terminates at `flagged`.
  Story 6.2 implemented that model in PR #144.
  What remains of that signature belongs to Story 6.2b: the corpus-backed measurement and the recorded signature.
  The nine machine-translated locale catalogs no native speaker has read are still open in `deferred-work.md`.
- Corrected on 2026-09-05: this section named Step 34 as the latest completed step in one bullet and Step 36 in another.
  It also described Story 5.3 as `in-progress` with its mobile, Pact, Playwright and Maestro tiers cut, four weeks after three of those four landed and the story moved to `done`.
- Corrected on 2026-08-26: this section named "no workflow runs `test:integration`" as the highest-value open item, which was false when written.
  `apps/api/vitest.config.ts` includes `integration/**/*.spec.ts`, so `quality-gate`'s `test:coverage` step already runs the whole integration tier against its own PostgreSQL service.
  The real gap was a silent skip when that database is unreachable, and `5.4-INT-031` closes it.
- Keep this section aligned with `_bmad-output/implementation-artifacts/sprint-status.yaml`.

## The whole project in plain English

| Step | Caveman version                                                              |
| ---: | ---------------------------------------------------------------------------- |
|    1 | Decide what to build and why.                                                |
|    2 | Know which app or package owns each job.                                     |
|    3 | Define data once. Seed predictable examples.                                 |
|    4 | Keep local, test, and production settings separate and safe.                 |
|    5 | Put slow or retryable work in queues.                                        |
|    6 | Send live updates. Poll when live updates fail.                              |
|    7 | Make CI catch broken code before release.                                    |
|    8 | Track the same analytics events everywhere.                                  |
|    9 | Start tracing before the API starts.                                         |
|   10 | Send useful telemetry to Grafana. Build dashboards from it.                  |
|   11 | Log API requests without leaking secrets.                                    |
|   12 | Test real user flows across the API, Web, and Mobile.                        |
|   13 | Serve one OpenAPI contract from the API.                                     |
|   14 | Write public API rules once in Zod.                                          |
|   15 | Validate the contract. Generate clients. Use those clients.                  |
|   16 | Fetch weather, store it, and survive provider failures.                      |
|   17 | Match weather to alert rules and deliver notifications.                      |
|   18 | Record telemetry and audit events without blocking users.                    |
|   19 | Build and cache daily outfit recommendations.                                |
|   20 | Let users say they run hot or cold.                                          |
|   21 | Explain why an outfit was recommended.                                       |
|   22 | Keep translations complete and consistent.                                   |
|   23 | Send small, ready-to-display data to phone widgets.                          |
|   24 | Send glanceable weather and outfit data to Apple Watch.                      |
|   25 | Make the wardrobe and community grid fit every screen.                       |
|   26 | Keep navigation simple on desktop and mobile.                                |
|   27 | Open the correct screen from widgets and notifications.                      |
|   28 | Make the product usable with keyboards and assistive technology.             |
|   29 | Upload a garment safely and process it in the background.                    |
|   30 | Use AI to suggest garment tags. Let the user decide.                         |
|   31 | Group ready garments into outfit capsules with optimistic UI.                |
|   32 | Guide a new user through closet setup, then model their body.                |
|   33 | Add disclosed affiliate links and durable purchase attribution.              |
|   34 | Take money, keep one entitlement ledger, and never trap a payer.             |
|   35 | Let paying users pick a palette. Prove it is readable first.                 |
|   36 | Read a face or a closet. Keep the answer, delete the photo.                  |
|   37 | Plan seven days. Say how sure the weather is. Fail one day only.             |
|   38 | Share looks with your weather twins. Screen first. Stay nameless.            |
|   39 | Look at the picture and read the words before anyone else can.               |
|   40 | Prove the screener on a real host. Sign only what passes.                    |
|   41 | Keep one reaction per member and synchronized counts.                        |
|   42 | Talk under a look. Screen it first. Keep every report on record.             |
|   43 | Ring a doorbell on change. Send each push at most once.                      |
|   44 | Rank local looks. Name a place only once five authors post there.            |
|   45 | Let members save a city. Fetch its weather before saying done.               |
|   46 | Tease the top local look on Home. Show something real or nothing.            |
|   47 | Let the owner sponsor a look. Label it. Re-check every click.                |
|   48 | Turn a look into a branded card. Save exactly the card you saw.              |
|   49 | Share that same card to other apps. Keep the preview after a failed handoff. |

## Special feature: AI garment tagging

### Caveman version

1. User uploads clothing photo.
2. Backend AI compares photo with fixed clothing labels.
3. AI guesses category and material.
4. Normal TypeScript rules turn those guesses into a comfort range.
5. User confirms or fixes the tags.
   User has final say.

### What "AI" means here

- FashionCLIP is a pretrained image classifier.
  It runs through ONNX and Transformers.js.
- It compares the image with fixed text prompts such as `a photo of a coat` and `a garment made from wool`, and returns a score for each prompt.
- FashionCLIP is an image-text classifier.
  Tagging runs without a large language model.
  It does not call OpenAI, generate content, learn from wardrobe photos, or fine-tune itself.
- "Local" means local to the backend wardrobe worker.
  The model does not run on the phone or in the browser.
- Model preparation downloads one pinned FashionCLIP snapshot from Hugging Face and verifies its SHA-256 hashes.
  Runtime inference loads those local files with remote model access disabled.

### How the app uses it

1. Garment commit adds a BullMQ `color-extraction` job.
2. A dedicated wardrobe worker process downloads the stored image.
3. `FashionClipTaggingEngine` sends the image to a separate Node worker thread.
   The thread runs one inference request at a time, so model work does not block API requests or overlap in memory.
4. FashionCLIP scores six category prompts and nine material prompts.
   The API converts the scores into probabilities and confidence flags.
5. Category is confident at score `0.55` with a `0.15` lead.
   Material is confident at score `0.45` with a `0.10` lead.
   Low-confidence values require user review.
6. TypeScript rules derive `cold`, `cool`, `mild`, `warm`, or `hot`.
   For example, wool maps to `cold` and linen maps to `hot`.
   FashionCLIP does not predict this field directly.
7. The worker stores the suggestions and changes the garment to `awaiting_tags`.
8. Web or Mobile asks the user to confirm or correct the tags.
   Both clients support ten locales, accessible radio choices, and screen reader status.
   Confirmation uses `PATCH /api/v1/wardrobe/garments/{garmentId}/tags` and changes the garment to `ready`.
9. Confirmation records telemetry and clears the Ritual cache so future outfits use the new tags.
10. If inference fails, the garment still moves to `awaiting_tags`, and the user can enter tags manually.
    If the dedicated wardrobe worker is not running, queued garments stay in `processing`, so production must deploy the worker and the verified model snapshot with the API.

### Stored data

- `tag_suggestions`: values, confidence scores, confidence flags, and model version.
- `tagging_failure_code`: why inference failed, when applicable.
- `tags_confirmed_at`: when the user accepted or corrected the tags.
- `awaiting_tags`: processing finished and user confirmation is required.

```mermaid
flowchart TD
  Upload[Garment uploaded] --> Queue[BullMQ job]
  Queue --> Worker[Wardrobe worker process]
  Worker --> Thread[Node worker thread]
  Thread --> Model[Local FashionCLIP ONNX model]
  Model --> Guess[Category and material guesses]
  Guess --> Rules[TypeScript comfort rules]
  Rules --> Review[User confirms or fixes tags]
  Review --> Ready[Garment ready]
```

## LLM collaborator prompt

Use this prompt when asking an LLM to improve this document or its matching code comments:

```text
You are improving Couture Cast learning docs and code commentary.

Primary goals:
1) Keep `_bmad-output/project-knowledge/learning-path-step-by-step.md` clear, lean, and teachable.
2) Preserve one standardized section template across every numbered step.
3) Keep the plain-English project map and special feature sections accurate.
4) Make `Task owner map` the main search surface for finding source code.
5) Keep implementation-anchor comments aligned with owner IDs in this document.

"Caveman but professional" style:
- Write for a smart engineer who is new to this repository.
- Explain the idea as if drawing it on a whiteboard.
- State the outcome first. Add implementation detail after it.
- Prefer short subject-verb-object sentences.
- Put one main idea in each sentence.
- Use common words. Define necessary jargon once.
- Use concrete examples when a rule is abstract.
- Keep paragraphs short. Prefer lists for sequences and choices.
- Preserve exact paths, contracts, thresholds, failure states, and security rules.
- Keep technical depth in the detailed step. Keep the opening summary simple.
- Do not use childish fragments, slang, marketing language, or vague claims.
- Do not remove a useful explanation only because the same topic has a short summary elsewhere.

Step template rules:
- The authoritative contract is `Instructions for LLMs updating this file` near the top.
- Every numbered step uses this order:
  `User/business impact`
  `Key takeaways`
  optional `Hard-won lessons from the implementation and code review of this story`
  `Story/Task mapping`
  `Story reference`
  `Cross-links`
  `Sequence to follow`
  `Task owner map`
  `Tests that cover this step`
  optional `Current repo note`
  optional `Architecture diagram`
- Special feature sections may appear before the numbered steps.
- A `ready-for-dev` story belongs in `Current position`; it does not receive a numbered learning
  step until implementation and review provide verified lessons.
- Do not add `Searchable strings:` or `Pattern summary:` sections.
- Remove a section only when it adds no useful information.

Mermaid rules:
- Open with exactly three backticks plus `mermaid` and close with three backticks.
- Close each diagram before the next heading.
- Parse or render every diagram after editing it.

Task owner map rules:
- Use the heading `Task owner map:` in every numbered step.
- Reuse the exact `Story X Task Y step Z owner` or `Step N step M owner` implementation anchor.
- Keep each owner bullet and full file path on one physical line.
- Prefer separate bullets when multiple files matter.
- Each numbered owner ID should appear exactly twice: here and at its implementation anchor.
- Use `_bmad-output/project-knowledge/owner-anchor-exceptions.md` when the target cannot hold a
  stable comment.

Test coverage map rules:
- Use the heading `Tests that cover this step:` in every numbered step.
- Group tests by level: unit/repository, component/client, integration, Pact, Playwright, mobile
  E2E, and performance. Omit only levels that genuinely have no coverage.
- List each direct test file once and explain the behavior or boundary it proves.
- State the evidence boundary when no direct executable test applies.
- List only direct suites under the test coverage map.
- Add a comment at the top of every listed test file naming the learning step and linking back to
  `_bmad-output/project-knowledge/learning-path-step-by-step.md`.
- Keep helpers and fixtures out of the list unless they contain assertions or are executable test
  entrypoints.

Code comment rules:
- Keep behavior unchanged unless the task asks for a behavior change.
- Keep comments concise and ASCII.
- Preserve Story/Task mapping and exact owner IDs.
- Explain what the code owns, the problem it solves, and any important alternative or failure path.

Working style:
- Make small edits. Preserve facts and working explanations.
- Remove fluff and true duplication.
- Run formatting, Markdown, owner-anchor, and Mermaid checks after editing.
```

## Step 1: Understand product-to-engineering traceability

User/business impact:

Tracing each feature back to the brief keeps the team building what users need.
Tying each delivery decision to the brief's goals and KPIs avoids scope drift and rework.

Key takeaways:

1. Traceability: `_bmad-output/project-knowledge/couturecast_brief.md` defines the vision and KPIs, and every downstream planning doc maps back to it.
2. Sequencing: `couturecast_roadmap.md` phase order drives `prd.md` scope and `epics.md` story decomposition.
3. Delivery alignment: each implementation story in `_bmad-output/implementation-artifacts/` should trace to both the PRD and architecture decisions.

Story/Task mapping:

- Pre-story planning artifacts (source of truth before implementation stories)

Story reference:

- none; this step is the pre-story planning chain that later stories inherit.

Cross-links:

- Step 2 turns this planning chain into concrete runtime and package boundaries.
- Every implementation story in `_bmad-output/implementation-artifacts/` should trace back to this chain.

Sequence to follow:

1. Read the brief for vision, target users, and success metrics.
2. Read the roadmap and PRD for release order and scoped requirements.
3. Read the architecture and epics to see how scope turns into implementation stories.

Task owner map:

- Step 1 step 1 owner: define the product vision, target users, and KPIs in `_bmad-output/project-knowledge/couturecast_brief.md`
- Step 1 step 2 owner: sequence the release plan in `_bmad-output/project-knowledge/couturecast_roadmap.md`
- Step 1 step 3 owner: translate the roadmap into scoped requirements in `_bmad-output/planning-artifacts/prd.md`
- Step 1 step 4 owner: capture the technical decision layer in `_bmad-output/planning-artifacts/architecture.md`
- Step 1 step 5 owner: decompose delivery into epics and implementation stories in `_bmad-output/planning-artifacts/epics.md` and `_bmad-output/implementation-artifacts/`

Tests that cover this step:

No executable test maps to this step.
The evidence is the trace from the brief to the roadmap, PRD, architecture, epics, and story artifacts.

Architecture diagram:

```mermaid
flowchart TD
  BRIEF[_bmad-output/project-knowledge/couturecast_brief.md<br/>vision, personas, success metrics]
  ROADMAP[_bmad-output/project-knowledge/couturecast_roadmap.md<br/>phase order and launch gates]
  PRD[_bmad-output/planning-artifacts/prd.md<br/>functional requirements]
  ARCH[_bmad-output/planning-artifacts/architecture.md<br/>technical decisions + ADRs]
  EPICS[_bmad-output/planning-artifacts/epics.md<br/>epics and stories]
  STORIES[_bmad-output/implementation-artifacts/0-*.md<br/>execution stories]
  CODE[apps/* + packages/*]

  BRIEF --> ROADMAP --> PRD --> ARCH --> EPICS --> STORIES --> CODE
```

## Step 2: Monorepo and app boundaries

User/business impact:

Clear app and package boundaries reduce breakage across surfaces and make web, mobile, and API behavior more consistent.
Teams can ship in parallel with fewer integration surprises.

Key takeaways:

1. Boundary clarity: `apps/web`, `apps/mobile`, and `apps/api` are separate runtime surfaces with distinct entrypoints.
2. Shared contracts and test primitives: apps share logic and types only through workspace packages, mainly `packages/api-client`, `packages/db`, `packages/testing`, and `packages/utils`.
3. Monorepo operations: root npm workspaces and `turbo.json` coordinate `dev`, `test`, and `build` across the repo.
4. **Runtime and app-owned deps:** anything an app or package imports, or any script in that folder runs (`nest build`, `tsc`, a CLI), must be listed in that folder's `package.json` (`dependencies` or `devDependencies` by use).
   A root-only listing can break hosted installs, because Vercel and similar platforms often see the repo root differently from your laptop.
5. **Root `package.json` deps:** the root holds repo-wide tooling that root `npm run` scripts use: ESLint, Prettier, TypeScript, Turbo, Vitest, Playwright, OpenAPI Generator CLI, Prisma CLI, `tsx`, `rimraf`, `cross-env`, Supabase CLI, Husky, etc.
   If only root scripts need a tool, root `devDependencies` is fine.
6. **Exceptions (also at root on purpose):** a few shared runtime or CLI deps stay at root when several workspaces or root scripts need the same version; here that is `@prisma/client` and `prisma` for `db:*` and generate flows.
   Any other dep that one app imports at runtime still goes in that app's `package.json`, even when root lists it too, because deploys need it spelled out.

Story/Task mapping:

- Story 0.1
- Task 2 (mobile app init), Task 3 (web app init), Task 4 (API app init), Task 5 (workspace config)

Story reference:

- `_bmad-output/implementation-artifacts/0-1-initialize-turborepo-monorepo.md`

Cross-links:

- Step 1 explains why these boundaries exist before code is written.
- Step 3 and Step 14 both build on the shared packages.

Sequence to follow:

1. Start at the root workspace and task graph in the repo root.
2. Open the web, mobile, and API entrypoints to see each runtime boundary.
3. Trace shared contracts and utilities through `packages/api-client`, `packages/db`, `packages/testing`, and `packages/utils`.

Task owner map:

- Step 2 step 1 owner: define the workspace and task graph boundaries in `package.json` and `turbo.json`
- Step 2 step 2 owner: define the web runtime boundary in `apps/web/src/app/layout.tsx`
- Step 2 step 3 owner: define the mobile runtime boundary in `apps/mobile/app/_layout.tsx` and `apps/mobile/app/(tabs)/_layout.tsx`
- Step 2 step 4 owner: define the API runtime boundary in `apps/api/src/main.ts`
- Step 2 step 5 owner: define shared package boundaries in `packages/api-client/package.json`, `packages/db/package.json`, `packages/testing/package.json`, and `packages/utils/package.json`

Tests that cover this step:

No executable test maps to this step.
The evidence is the workspace manifests, Turbo tasks, build boundaries, and app entrypoints.

Current repo note:

- **Rule of thumb:** apps and packages list what they use directly; root holds shared dev tooling and a few intentional pins (Prisma).
  Listing a package under both `apps/api` and the root is normal when both need it for different reasons; check the lockfile once.
- **Workspace install baseline:** use Node 24 from `.nvmrc` when adding or reconciling workspaces.
  The root preinstall guard fails fast on older runtimes before npm can update the workspace graph.
- **Testing workspace boundary:** `packages/testing` owns shared factories, cleanup helpers, and starter templates.
  Its lint and typecheck scripts cover both `src` and `templates` on purpose, so the CLI reports the same red files the IDE does.
- **Pure shared logic boundary:** `packages/utils` holds small runtime-safe policy helpers that web, mobile, and API all need.
  The current example is the signup age gate: parse birthdates once, calculate age once, and let each app's adapter reuse that behavior.
- **Test review baseline:** PRs that touch automated tests use the shared checklist in `.github/PULL_REQUEST_TEMPLATE.md` and the expectations in `_bmad-output/test-artifacts/testing-standards.md`.
  Default to `@couture/testing` fixtures, and reset or clean up any registered entities in `afterEach`.

Architecture diagram:

```mermaid
flowchart TD
  ROOT[Root workspace<br/>package.json workspaces + turbo.json]
  TURBO[Turbo task graph<br/>dev / test / build]

  ROOT --> WEB[apps/web<br/>Next.js App Router]
  ROOT --> MOBILE[apps/mobile<br/>Expo Router]
  ROOT --> API[apps/api<br/>NestJS bootstrap]
  ROOT --> APICLIENT[packages/api-client<br/>shared API/event contracts]
  ROOT --> DB[packages/db<br/>Prisma schema + client]
  ROOT --> TESTING[packages/testing<br/>shared fixture factories + cleanup registry]
  ROOT --> UTILS[packages/utils<br/>shared pure runtime helpers]
  ROOT --> ESLINT[packages/eslint-config]

  ROOT --> TURBO
  TURBO --> WEB
  TURBO --> MOBILE
  TURBO --> API

  WEB --> APICLIENT
  WEB --> UTILS
  MOBILE --> APICLIENT
  MOBILE --> UTILS
  APICLIENT --> API
  API --> DB
  API --> UTILS
```

## Step 3: Data model and deterministic seeds

User/business impact:

A stable schema and deterministic seeds make recommendations and lookbook flows behave the same in every environment.
Reproducible data and migrations make releases safer and debugging faster.

Key takeaways:

1. Schema-first modeling: `packages/db/prisma/schema.prisma` is the single source for relational models, enums, and user-scoped tables.
2. Deterministic seeding: seeds use stable IDs, seeded randomness (`faker.seed(4242)`), and `upsert` to keep reruns reproducible.
3. Dependency-safe order: `seedUsers -> seedWardrobe -> seedWeather -> seedRituals` runs in that order so foreign keys resolve for recommendation and lookbook data.

Story/Task mapping:

- Story 0.2
- Task 2 (core schema tables), Task 5 (seed scripts), Task 7 (validation/testing)

Story reference:

- `_bmad-output/implementation-artifacts/0-2-configure-prisma-schema-migrations-and-seed-data.md`

Cross-links:

- Step 2 explains why schema and seed logic belongs in `packages/db`.
- Step 4 applies these schema and seed rules across Supabase environments.

Sequence to follow:

1. Read `schema.prisma` first, because it is the relational source of truth.
2. Read the seed index for the deterministic order and rerun safety.
3. Read one seed module to see stable IDs and seeded randomness in use.

Task owner map:

- Step 3 step 1 owner: define the relational source of truth in `packages/db/prisma/schema.prisma`
- Step 3 step 2 owner: orchestrate deterministic seed execution in `packages/db/prisma/seeds/index.ts`
- Step 3 step 3 owner: prove a deterministic seeded domain slice in `packages/db/prisma/seeds/weather.ts`

Tests that cover this step:

No executable test proves the full seed order, stable seed identity, or idempotent upserts described here.
The evidence today is running Prisma migrate, reset, and seed.
Later domain factory and schema suites cover their own slices.

Architecture diagram:

```mermaid
flowchart TD
  SCHEMA[schema.prisma]
  MIGRATE[Prisma migrate/generate]
  SEEDINDEX[prisma/seeds/index.ts]

  USERS[seedUsers<br/>guardian/teen users + consent]
  WARDROBE[seedWardrobe<br/>garments + palette insights]
  WEATHER[seedWeather<br/>wx-1..wx-10 snapshots + segments]
  RITUALS[seedRituals<br/>outfits, lookbook, engagement, audit]
  DB[(Postgres via Prisma)]

  SCHEMA --> MIGRATE --> SEEDINDEX
  SEEDINDEX --> USERS
  SEEDINDEX --> WARDROBE
  SEEDINDEX --> WEATHER
  SEEDINDEX --> RITUALS

  USERS --> DB
  WARDROBE --> DB
  WEATHER --> DB
  RITUALS --> DB

  USERS --> RITUALS
  WARDROBE --> RITUALS
  WEATHER --> RITUALS
```

## Step 4: Environment setup and Supabase operations

User/business impact:

Careful Supabase environment and secret handling reduces the auth, storage, and database misconfigurations that users see as outages or failed logins.
Deploys and recoveries across Preview and Production become more reliable.

Key takeaways:

1. Supabase environments are separate: local and CI stacks, plus cloud Preview and Production projects.
2. Each operation targets one environment: `npx supabase start/link/db push`, `npx prisma migrate deploy --schema packages/db/prisma/schema.prisma`, pool targets (Preview 50, Production 100), and plan-gated PITR/backups.
3. Keep `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_KEY`, and `DATABASE_URL` aligned across `.env.local`, `.env.preview`, `.env.prod`, and the secrets manager.
4. After signup, Supabase JWT claims still have to resolve to the app's text `User.id` before guardian-aware RLS can protect teen wardrobe data.

Story/Task mapping:

- Story 0.3
- Task 3 (Supabase CLI), Task 4 (pooling/backups), Task 5 (env configuration)
- Story 0.11
- Task 4 (guardian-aware RLS migration rollout and validation)

Story reference:

- `_bmad-output/implementation-artifacts/0-3-set-up-supabase-projects-dev-staging-prod.md`

Cross-links:

- Step 3 defines the schema and seeds these environments must run.
- Step 14 explains why signup age-verification and guardian-consent rules are enforced in database policy as well as in the HTTP contract.
- Step 7 carries the same environment contract into CI and deployment automation.

Sequence to follow:

1. Identify the active environment names and which ones are deferred on purpose.
2. Trace how Supabase CLI and Prisma target those environments.
3. Read the guardian-aware RLS migration and the JWT-claim bridge from Supabase Auth to the repo's text `User.id` values.
4. Verify teen, guardian, outsider, anon, and admin policy behavior in DB-level tests before deploying to shared environments.
5. Keep datasource and secret names aligned across local, CI, and hosted environments.

Task owner map:

- Step 4 step 1 owner: anchor the application datasource and database contract in `packages/db/prisma/schema.prisma`
- Step 4 step 2 owner: define Supabase environment and operational rules in `_bmad-output/implementation-artifacts/0-3-set-up-supabase-projects-dev-staging-prod.md`
- Step 4 step 3 owner: keep local, CI, and hosted environment naming aligned in `_bmad-output/implementation-artifacts/0-3-set-up-supabase-projects-dev-staging-prod.md`
- Story 0.11 Task 4 owner: enforce guardian-aware RLS and the auth-claim bridge in `packages/db/prisma/migrations/20260420113000_add_guardian_shared_rls_policies/migration.sql`

Tests that cover this step:

Real PostgreSQL integration test:

- [`packages/db/test/rls/guardian-wardrobe.spec.ts`](../../packages/db/test/rls/guardian-wardrobe.spec.ts):
  exercises the live Supabase-style claim bridge and the teen and guardian policy boundaries.
- [`packages/db/test/rls/identity-and-admin.spec.ts`](../../packages/db/test/rls/identity-and-admin.spec.ts):
  covers spoofed claims, unverified email, revoked consent, and the administrator actor.

Current repo note:

- Step 4 includes the first real Supabase policy rollout.
  `packages/db/prisma/migrations/20260420113000_add_guardian_shared_rls_policies/migration.sql` applies guardian-aware access rules across the private wardrobe tables.
  The `packages/db/test/rls/` suite proves the teen, guardian, and admin personas against a live Postgres policy surface before deploy.
  Task 6 then adds `packages/db/prisma/migrations/20260421090000_block_revoked_teens_from_self_access/migration.sql`, which blocks teen self-access again when the last active guardian consent is revoked.

Architecture diagram:

```mermaid
flowchart TD
  ENGINEER[Engineer + CI] --> ENV[Env files and secrets<br/>.env.local .env.preview .env.prod]
  ENV --> CLI[Supabase CLI<br/>start link db push]
  CLI --> LOCAL[Local Supabase stack]
  LOCAL --> PRISMA[Prisma schema + seeds]

  CLI --> PREVIEWSB[Supabase cloud<br/>Preview]
  CLI --> PRODSB[Supabase cloud<br/>couturecast-prod]

  PREVIEWSB --> AUTH[Auth + guardian-aware RLS]
  PRODSB --> AUTH
  PREVIEWSB --> BUCKETS[Storage buckets<br/>wardrobe-images derived-assets community-uploads]
  PRODSB --> BUCKETS
```

## Step 5: Queueing and worker reliability

User/business impact:

Retries, backoff, and failure replay let async jobs finish through traffic spikes and transient failures, so users still get their core updates.
Durable failure records prevent silent job loss and shorten incident recovery, protecting engagement and operations.

Key takeaways:

1. Parallelization: workers process jobs concurrently, outside request threads.
2. Resiliency: retries, backoff, and DLQ-style failure capture prevent job loss.
3. Operability: persisted failures plus admin replay and prune flows make incidents traceable and recoverable.

Story/Task mapping:

- Story 0.4
- Task 2 (BullMQ queues), Task 3 (DLQ), Task 4 (concurrency), Task 5 (worker process group)

Story reference:

- `_bmad-output/implementation-artifacts/0-4-configure-redis-upstash-and-bullmq-queues.md`

Cross-links:

- Step 2 separates request-serving apps from background worker processes.
- Steps 10 and 11 extend these queues into telemetry and structured logging.

Sequence to follow:

1. Read the shared queue config and retry policy first.
2. Read worker bootstrap for concurrency and rate-limit policy.
3. Read DLQ capture and the admin replay and prune flows for failure recovery.

Task owner map:

- Story 0.4 Task 2 owner: define shared BullMQ queue names, retry policy, timeouts, and queue construction in `apps/api/src/config/queues.ts`
- Story 0.4 Task 3 owner: persist failed job context as durable DLQ records for operator workflows in `apps/api/src/workers/base.worker.ts`
- Story 0.4 Task 4 owner: apply per-queue concurrency and rate-limit policy during worker startup in `apps/api/src/workers/bootstrap.ts`
- Story 0.4 Task 5 owner: bootstrap and shut down the dedicated worker process group cleanly in `apps/api/src/workers/bootstrap.ts`
- Step 5 support owner: expose operator read, replay, and prune flows in `apps/api/src/admin/admin.service.ts` and `apps/api/src/admin/admin.controller.ts`

Tests that cover this step:

Worker and operator unit tests:

- [`apps/api/src/workers/base.worker.spec.ts`](../../apps/api/src/workers/base.worker.spec.ts):
  proves shared retry settings, queue concurrency, processor wiring, and durable dead-letter writes on failed jobs.
- [`apps/api/src/admin/admin.service.spec.ts`](../../apps/api/src/admin/admin.service.spec.ts):
  proves bounded DLQ listing, queue filtering, retention, replay, and preservation of a failed record when requeueing fails.
- [`apps/api/src/admin/admin.controller.spec.ts`](../../apps/api/src/admin/admin.controller.spec.ts):
  proves the operator controller delegates list and replay requests to the service with the requested queue and job identity.
- Historical reference: `apps/api/src/admin/admin.cron.spec.ts`:
  the original test map assigns scheduled 30-day pruning and scheduler survival after pruning failure to this suite.
  This file is absent from the current checkout, so that direct coverage remains unverified.
- [`apps/api/src/workers/shutdown-resources.spec.ts`](../../apps/api/src/workers/shutdown-resources.spec.ts):
  proves dependency-ordered shutdown, continued cleanup after rejection, and forced disconnect after the graceful deadline.

Architecture diagram:

```mermaid
flowchart TD
  API[API producers] --> Q[BullMQ queues]

  Q --> WQ[weather-ingestion]
  Q --> AQ[alert-fanout]
  Q --> CQ[color-extraction]
  Q --> MQ[moderation-review]

  subgraph WG[Worker process group]
    WW[weather worker<br/>concurrency: 10]
    AW[alert worker<br/>concurrency: 20]
    CW[color worker<br/>concurrency: 5]
    MW[moderation worker<br/>concurrency: 10]
  end

  WQ --> WW
  AQ --> AW
  CQ --> CW
  MQ --> MW

  WW -->|failed| DLQ[(Postgres jobFailure)]
  AW -->|failed| DLQ
  CW -->|failed| DLQ
  MW -->|failed| DLQ

  ADM[Admin API<br/>failed-jobs / retry] --> DLQ
  ADM -->|re-enqueue| Q
```

## Step 6: Realtime and push delivery

User/business impact:

Step 6 gives users faster ritual updates and more reliable alerts when connections are unstable.
Fewer missed notifications protects engagement and retention.

Key takeaways:

1. Socket, Push, and Polling all deliver on purpose, so alerts survive disconnects and weak networks.
2. Shared payload contracts keep channels aligned: `lookbook:new`, `ritual:update`, and `alert:weather` all use `{ version, timestamp, userId, data }`.
3. Fallback is deterministic: reconnect backoff (1s/3s/9s, max 5), then polling `GET /api/v1/events/poll` until the socket recovers.

Story/Task mapping:

- Story 0.5
- Task 1 (Socket.io server), Task 2 (connection lifecycle), Task 3 (Expo Push), Task 4 (shared payload schema), Task 5 (fallback)

Story reference:

- `_bmad-output/implementation-artifacts/0-5-initialize-socketio-gateway-and-expo-push-api.md`

Cross-links:

- Step 5 explains the async work that feeds alert and ritual delivery.
- Step 12 verifies these fallback paths through end-to-end coverage.

Sequence to follow:

1. Start with the gateway and connection lifecycle rules.
2. Trace push-token persistence and push dispatch for offline delivery.
3. Follow the polling fallback path used when realtime is unavailable.

Task owner map:

- Story 0.5 Task 1 owner: expose the Socket.io gateway surface and attach the core auth + connection orchestration in `apps/api/src/modules/gateway/gateway.gateway.ts`
- Story 0.5 Task 2 owner: decide retry vs fallback based on connection lifecycle state in `apps/api/src/modules/gateway/connection-manager.service.ts`
- Step 6 polling backend owner: provide the incremental polling data path in `apps/api/src/modules/events/events.service.ts`
- Step 6 push token owner: keep push token persistence durable in `apps/api/src/modules/notifications/push-token.repository.ts`
- Story 0.5 Task 3 owner: dispatch Expo push notifications for users who are not on an active realtime session in `apps/api/src/modules/notifications/push-notification.service.ts`
- Story 0.5 Task 4 owner: define shared socket payload schemas for realtime namespaces in `packages/api-client/src/types/socket-events.ts`
- Story 0.5 Task 5 owner: activate, advance, and stop client polling when realtime is unavailable in `packages/api-client/src/realtime/polling-service.ts`

Tests that cover this step:

API and shared-client unit tests:

- [`apps/api/src/modules/gateway/gateway.test.ts`](../../apps/api/src/modules/gateway/gateway.test.ts):
  proves reconnect backoff, fallback activation, lifecycle reset, and structured retry metadata.
- [`apps/api/src/modules/gateway/gateway.gateway.spec.ts`](../../apps/api/src/modules/gateway/gateway.gateway.spec.ts):
  proves namespace boundaries, socket authentication, server-owned user rooms, and user-targeted weather delivery.
- [`apps/api/src/modules/events/events.controller.spec.ts`](../../apps/api/src/modules/events/events.controller.spec.ts):
  proves authenticated polling, an empty initial result, and invalid cursor rejection.
- [`apps/api/src/modules/events/events.service.spec.ts`](../../apps/api/src/modules/events/events.service.spec.ts):
  proves event delivery with an advancing cursor and the empty-result cursor contract.
- [`apps/api/src/modules/events/events.repository.spec.ts`](../../apps/api/src/modules/events/events.repository.spec.ts):
  proves user and global event scoping with and without a cursor.
- [`apps/api/src/modules/notifications/notifications.test.ts`](../../apps/api/src/modules/notifications/notifications.test.ts):
  proves Expo token validation, 100-message batching, selective retries, timeouts, and mixed ticket handling.
- [`apps/api/src/modules/notifications/push-token.repository.spec.ts`](../../apps/api/src/modules/notifications/push-token.repository.spec.ts):
  proves normalized token persistence, user lookup, provider-invalid token deletion, and deduplication.
- [`packages/api-client/testing/polling-service.spec.ts`](../../packages/api-client/testing/polling-service.spec.ts):
  proves immediate polling, cursor progress, the 30-second cadence, failure recovery, stop, and restart behavior.

Performance test:

- [`k6/tests/couture-api-baseline.k6test.ts`](../../k6/tests/couture-api-baseline.k6test.ts):
  exercises the realtime polling endpoint and applies its environment-adjusted P95 latency and aggregate failure thresholds.

Architecture diagram:

```mermaid
flowchart TD
  ES[Events service] --> GW[Socket gateway namespaces]
  GW --> LB[lookbook:new]
  GW --> RU[ritual:update]
  GW --> AW[alert:weather]

  ES --> PUSH[Push notification service]
  PUSH --> EXPO[Expo Push API]
  EXPO --> DEVICE[Mobile device notifications]

  CM[Connection manager<br/>retry/backoff] --> GW
  CM --> FALLBACK[Fallback switch]
  FALLBACK --> POLL[Polling service]
  POLL --> API[GET /api/v1/events/poll]
  API --> DEVICE
  GW --> DEVICE
```

## Step 7: CI and CD automated quality gates

User/business impact:

CI/CD gates catch regressions before merge and release, so users hit fewer broken core flows.
The team ships faster with fewer hotfixes.

Key takeaways:

1. PR gates are split: `pr-checks.yml` blocks on typecheck, lint, test, and build; `pr-pw-e2e-local.yml` runs sharded Playwright and enforces the required E2E gate.
2. `rwf-burn-in.yml` reruns changed Playwright specs 3x before the full E2E run, and `SKIP_BURN_IN` overrides it.
3. Vercel Preview smoke runs on `deployment_status` (`pr-pw-e2e-vercel-preview.yml`); mobile deploy stays manual through `deploy-mobile.yml`.
4. `pr-checks.yml` runs every workspace's tests with coverage and passes the workspace coverage directories to a composite action.
   That action posts a sticky PR comment with statements, branches, functions, and lines, and updates four shields.io badges on push to main.

Story/Task mapping:

- Story 0.6 (status: review), Story 0.14 Task 7 (coverage reporting)
- Task 1 (test workflow), Task 2 (parallelization), Task 12 (PR preview smoke), Task 13 (API deployment prep), Story 0.14 Task 7 (coverage PR comments and badges)

Story reference:

- `_bmad-output/implementation-artifacts/0-6-scaffold-cicd-pipelines-github-actions.md`

Cross-links:

- Step 2 defines the apps and packages these workflows exercise.
- Step 12 plugs cross-surface smoke coverage into this gate.
- Step 15 adds contract automation to the same quality-gate model.
- Story 0.14 Task 7 extends this gate with merged monorepo coverage, PR comments, and badges.

Sequence to follow:

1. Read the required PR workflows first.
2. See how burn-in, preview smoke, and secret scanning add to the base checks.
3. Note which deploy paths are automated and which stay manual by design.
4. Trace how monorepo coverage is collected, merged, and shown in PRs and badges.

Task owner map:

- Step 7 step 1 owner: enforce base PR quality gates in `.github/workflows/pr-checks.yml`
- Step 7 step 2 owner: enforce local Playwright E2E gating in `.github/workflows/pr-pw-e2e-local.yml`
- Step 7 step 3 owner: control flake burn-in behavior in `.github/workflows/rwf-burn-in.yml`
- Step 7 step 4 owner: verify preview deployments with targeted smoke checks in `.github/workflows/pr-pw-e2e-vercel-preview.yml`
- Step 7 step 5 owner: enforce secret scanning in `.github/workflows/gitleaks-check.yml`
- Step 7 step 6 owner: keep the mobile deployment path explicit in `.github/workflows/deploy-mobile.yml`
- Step 7 support owner: centralize install and browser setup in `.github/actions/install/action.yml` and `.github/actions/setup-playwright-browsers/action.yml`
- Step 7 step 7 owner: wire monorepo workspace coverage directories and badge inputs in `.github/workflows/pr-checks.yml`
- Step 7 step 8 owner: merge workspace summaries, upload coverage artifact, parse metrics, comment on PR, and update four gist-backed badges in `.github/actions/unit-test-coverage-comment/action.yml`

Tests that cover this step:

Workflow structure unit test:

- [`apps/api/integration/deployment-workflows.spec.ts`](../../apps/api/integration/deployment-workflows.spec.ts):
  asserts the preview and mobile deployment workflow files, unified Vercel configuration, CI-safe API preparation, and migration-before-build ordering.

Playwright deployed smoke test:

- [`playwright/tests/web-health-sha.spec.ts`](../../playwright/tests/web-health-sha.spec.ts):
  verifies deployed health metadata and the expected Git revision used by preview smoke gating.

Architecture diagram:

```mermaid
flowchart TD
  PR[Pull request] --> PRCHECKS[pr-checks.yml<br/>typecheck + lint + test + build]
  PR --> GITLEAKS[gitleaks-check.yml]
  PR --> E2E[pr-pw-e2e-local.yml]

  E2E --> BURNIN[rwf-burn-in.yml<br/>changed Playwright specs x3]
  BURNIN --> SHARDS[Playwright shards<br/>1/2 + 2/2]
  SHARDS --> MERGE_REPORTS[merge-reports<br/>artifact + summary]
  MERGE_REPORTS --> E2E_GATE[E2E required gate]

  PR --> PREVIEW[Vercel Preview deployment]
  PREVIEW --> PREVIEW_SMOKE[pr-pw-e2e-vercel-preview.yml<br/>web-health-sha smoke]

  PRCHECKS --> COV[Coverage action merges summaries<br/>all workspaces]
  COV --> COMMENT[Sticky PR comment<br/>coverage metrics table]
  COV --> SUMMARY[Step summary<br/>coverage in workflow run]

  PRCHECKS --> READY{Ready to merge?}
  GITLEAKS --> READY
  E2E_GATE --> READY
  PREVIEW_SMOKE --> READY
  COMMENT --> READY

  READY --> MAIN[Merge to main]
  MAIN --> PROD[Vercel Production deploy<br/>web + API serverless target]
  MAIN --> MOBILE[deploy-mobile.yml<br/>manual Android EAS build]
  MAIN --> BADGE[Update four shields.io badges<br/>via gist]
```

### Coverage reporting and badges: reproducible setup

This recipe adds unit test coverage PR comments and shields.io badges to any repo, single or monorepo.
In Couture Cast it writes four badges (`statements`, `branches`, `functions`, `lines`) into gist-backed JSON files.

#### Prerequisites

- The test runner produces `coverage-summary.json` in Istanbul/v8 format (Vitest `json-summary`, Jest `json-summary`, or normalized output from pytest-cov / JaCoCo).
- A GitHub Actions workflow that runs tests.

#### Step 1: Configure test runner to emit `json-summary`

Files: `apps/api/vitest.config.ts`, `apps/web/vitest.config.ts`, `apps/mobile/vitest.config.ts`, `packages/api-client/vitest.config.ts`, `packages/config/vitest.config.ts`

Add `"json-summary"` to the coverage reporter array in each test config:

```typescript
// vitest.config.ts
coverage: {
  reporter: ['text', 'json-summary', 'lcov'],
}
```

For Jest, add `"json-summary"` to `coverageReporters` in `jest.config.js`.

#### Step 2: Add `test:coverage` scripts

Files: `package.json` (root), `apps/api/package.json`, `apps/web/package.json`, `apps/mobile/package.json`, `packages/api-client/package.json`, `packages/config/package.json`

Each workspace, or the root in a single repo, needs a script that runs tests with `--coverage`:

```json
"test:coverage": "vitest run --coverage"
```

For monorepos, add a root script that fans out:

```json
"test:coverage": "node scripts/run-workspace-test-coverage.mjs"
```

#### Step 3: Create the composite action

File: `.github/actions/unit-test-coverage-comment/action.yml`

Copy this file into the target repo.
The action:

1. **Merges** workspace coverage summaries in a monorepo.
   When the `workspace-dirs` input is set, it reads each workspace's `coverage-summary.json`, sums the totals, and always writes a merged summary.
   It emits `::warning::` listing any missing summaries, and `::error::` if all are missing.
2. **Uploads** the coverage directory as an artifact.
3. **Parses** `coverage-summary.json` with `jq` to extract statements/branches/functions/lines.
4. **Builds** a direct artifact download URL from the upload step output.
5. **Writes** a markdown coverage table to `$GITHUB_STEP_SUMMARY`.
6. **Posts** a sticky PR comment with the coverage table and download link, found and updated through the `<!-- unit-test-coverage-comment: {label} -->` HTML marker.
7. **Updates** four shields.io badge JSON files in a GitHub gist with one `curl`/`jq` PATCH request, only on a push to the default branch with a passing test run.

Every `${{ inputs.* }}` value goes through an `env:` block before any `run:` or `script:` step reads it.
All bash steps use `set -euo pipefail`.
The gist write uses `Authorization: Bearer` so fine-grained PATs work.
The legacy `Authorization: token` header fails with fine-grained PATs.

#### How the PR comment works (implementation details)

File: `.github/actions/unit-test-coverage-comment/action.yml` (the "Comment coverage on PR" step)

The comment step uses `actions/github-script@v7` to create or update a PR comment through the GitHub API.
Comments are sticky: one comment per suite label, updated on each push.

**1. HTML marker for identity**

Each comment starts with a hidden HTML marker that the script searches for:

```html
<!-- unit-test-coverage-comment: Unit Tests -->
```

The marker includes `test-suite-label`, so multiple suites such as "Unit Tests" and "Integration Tests" get separate sticky comments.

**2. Find-and-update logic**

```javascript
// List all comments on the PR
const comments = await github.paginate(github.rest.issues.listComments, {
  owner: context.repo.owner,
  repo: context.repo.repo,
  issue_number: context.issue.number,
  per_page: 100,
})

// Search for existing comment by marker
const marker = `<!-- unit-test-coverage-comment: ${label} -->`
const existing = comments.find((c) => c.body && c.body.includes(marker))

if (existing) {
  // Update the existing comment in place
  await github.rest.issues.updateComment({
    owner: context.repo.owner,
    repo: context.repo.repo,
    comment_id: existing.id,
    body,
  })
} else {
  // First push on this PR: create the comment
  await github.rest.issues.createComment({
    owner: context.repo.owner,
    repo: context.repo.repo,
    issue_number: context.issue.number,
    body,
  })
}
```

**3. Comment body format**

The body is built from step outputs (coverage percentages, test outcome, artifact URL):

```markdown
<!-- unit-test-coverage-comment: Unit Tests -->

## 🧪 Unit Tests Coverage: ✅ **SUCCESS**

| Metric     | Coverage | Threshold |
| ---------- | -------- | --------- |
| Statements | 92.5%    | 90%       |
| Branches   | 83.1%    | 80%       |
| Functions  | 91.2%    | 90%       |
| Lines      | 93.0%    | 90%       |

📦 **[Download Full Report](https://github.com/.../artifacts/123)**

_Thresholds enforced by test runner in CI_
```

The threshold column and footer appear only when the `thresholds` input is set.
Without thresholds, the table has two columns.

**4. Guard rails**

- `if: github.event_name == 'pull_request'` limits comments to PRs.
- Fork PRs are skipped, because the action comments only when head and base are in the same repository.
- The test step uses `continue-on-error: true` and fails in a later step, so the comment still posts and reviewers see coverage on red PRs.

**5. Required permission**

The workflow needs `pull-requests: write` at the top level:

```yaml
permissions:
  contents: read
  pull-requests: write
```

**6. Reusing this pattern for other PR comments**

The same sticky comment pattern works for any PR automation.
Swap the marker string and body builder:

```javascript
const marker = `<!-- my-custom-check: ${someLabel} -->`
const body = [marker, '## My Check Results', '', '...details...'].join('\n')
// then the same find-and-update logic as above
```

#### Step 4: Create a GitHub gist for the badge

1. Go to [gist.github.com](https://gist.github.com) and create a **public** gist.
2. Add any placeholder file (content can be `{}`) so the gist exists.
3. Copy the gist ID from the URL (the hex string after the username).
4. The action later writes four files using `badge-filename-prefix`: `<repo-name>-statements.json`, `<repo-name>-branches.json`, `<repo-name>-functions.json`, and `<repo-name>-lines.json`.
5. Optional: pre-seed those four files with valid shields JSON so the README badges render right away.
   Without it, they show `no resource found` until the first successful push to the default branch.

#### Step 5: Create a PAT with `gist` scope

1. Go to [github.com/settings/tokens](https://github.com/settings/tokens) on the account that owns the gist.
2. Create a fine-grained or classic token with **only the `gist` scope**.
3. Store it as a repo secret named `COVERAGE_GIST_TOKEN` in the target repo (Settings > Secrets and variables > Actions).

#### Step 6: Wire the workflow

File: `.github/workflows/pr-checks.yml`

For a single repo, add the coverage run and the action after the test step:

```yaml
on:
  pull_request:
  push:
    branches: [main]

permissions:
  contents: read
  pull-requests: write

steps:
  - name: Run tests with coverage
    id: tests
    continue-on-error: true
    run: npm run test:coverage

  - name: Coverage report and PR comment
    uses: ./.github/actions/unit-test-coverage-comment
    with:
      coverage-path: ./coverage
      coverage-summary-path: ./coverage/coverage-summary.json
      report-name: coverage-report-${{ github.event.pull_request.number || github.sha }}
      test-outcome: ${{ steps.tests.outcome }}
      thresholds: '{"statements":90,"branches":80,"functions":90,"lines":90}'
      badge-gist-id: <your-gist-id>
      badge-filename-prefix: <repo-name>
      badge-gist-auth: ${{ secrets.COVERAGE_GIST_TOKEN }}

  - name: Fail if tests failed
    if: steps.tests.outcome == 'failure'
    run: exit 1
```

For a monorepo, pass `workspace-dirs`, and the action merges the summaries itself:

```yaml
- name: Coverage report and PR comment
  uses: ./.github/actions/unit-test-coverage-comment
  with:
    coverage-path: ./coverage
    coverage-summary-path: ./coverage/coverage-summary.json
    report-name: coverage-report-${{ github.event.pull_request.number || github.sha }}
    test-outcome: ${{ steps.tests.outcome }}
    workspace-dirs: '["apps/api/coverage","apps/web/coverage","apps/mobile/coverage"]'
    badge-gist-id: <your-gist-id>
    badge-filename-prefix: <repo-name>
    badge-gist-auth: ${{ secrets.COVERAGE_GIST_TOKEN }}
```

When `workspace-dirs` is set, the action reads each workspace's `coverage-summary.json`, sums the raw totals, and writes a merged summary before parsing.
If any expected summaries are missing, it lists their filenames in a warning.
If every expected summary is missing, it also emits an error and still writes zeroed metrics, so the gap shows up in the comment.

#### Step 7: Add the badge to the README

File: `README.md`

```markdown
![statements](https://img.shields.io/endpoint?url=https://gist.githubusercontent.com/<github-user>/<gist-id>/raw/<repo-name>-statements.json)
![branches](https://img.shields.io/endpoint?url=https://gist.githubusercontent.com/<github-user>/<gist-id>/raw/<repo-name>-branches.json)
![functions](https://img.shields.io/endpoint?url=https://gist.githubusercontent.com/<github-user>/<gist-id>/raw/<repo-name>-functions.json)
![lines](https://img.shields.io/endpoint?url=https://gist.githubusercontent.com/<github-user>/<gist-id>/raw/<repo-name>-lines.json)
```

Badge color runs from red to bright green by percentage bucket, set in the action's `color_for_pct` helper.
The badges update in one gist PATCH request on every successful push to the default branch.

Couture Cast values:

- GitHub username: `muratkeremozcan`
- Gist ID: `64348ebdc6e662b93ade9f40bdc03442`
- Badge prefix: `couture-cast`

#### Step 8: Verify

1. Open a PR from the same repo; the sticky coverage comment appears.
2. Push another commit to that PR; the existing comment updates in place.
3. Merge to main; the gist gets the four badge JSON files, and the README badges show the new percentages.
4. Expect `not found` badges until the first successful push to the default branch populates the gist files.

#### Python and Java repos

The action only reads `coverage-summary.json`, so it works for any language.
For non-JS repos, add a normalization step before the action in the calling workflow:

- **Python** (`pytest-cov`): run `coverage json -o coverage-raw.json`, then transform `totals.percent_covered` / `totals.num_statements` / etc. into the Istanbul shape.
- **Java** (`JaCoCo`): parse `jacoco.csv`, sum the `INSTRUCTION`, `BRANCH`, `LINE`, and `METHOD` columns, and write the same Istanbul-shaped JSON.

The `functions` metric is `0` for Python, because coverage.py does not track functions.
The PR comment shows `N/A` for missing metrics.

## Step 8: Shared analytics contracts and event tracking

User/business impact:

Shared analytics contracts keep event names and payloads the same across web, mobile, and API, which cuts tracking bugs in user journeys.
Funnel and retention data stays trustworthy, so product decisions move faster.

Key takeaways:

1. Analytics contracts live in `packages/api-client/src/types/analytics-events.ts` to prevent event-name and payload drift.
2. Contract wrappers validate inputs, map them to snake_case PostHog properties, and emit the same payloads from web, mobile, and API.
3. Integration checks enforce the five core events and catch schema regressions early.

Story/Task mapping:

- Story 0.7
- Task 2 (event schema), Task 3 (event tracking in apps)

Story reference:

- `_bmad-output/implementation-artifacts/0-7-configure-posthog-opentelemetry-and-grafana-cloud.md`

Cross-links:

- Step 2 explains why analytics logic belongs in shared packages.
- Step 15 applies the same contract-first idea to REST generation and client usage.

Sequence to follow:

1. Start with the shared analytics event contracts and flag defaults.
2. Read the wrappers that normalize and emit events.
3. Trace consumption in web, mobile, API, and feature-flag evaluation.

Task owner map:

- Story 0.7 Task 2 step 1 owner: define canonical event names and input/property schemas in `packages/api-client/src/types/analytics-events.ts`
- Story 0.7 Task 2 step 2 owner: normalize domain inputs to snake_case analytics properties in track\* wrappers in `packages/api-client/src/types/analytics-events.ts`
- Story 0.7 Task 3 step 1 owner: publish shared track\* wrappers for app-layer reuse and integration assertions in `packages/api-client/src/types/analytics-events.ts`
- Step 8 app reuse owner: consume the shared analytics wrappers in `apps/mobile/src/analytics/track-events.ts` and `apps/web/src/app/components/analytics-event-actions.tsx`
- Step 8 lightweight DOM path owner: cover attribute-driven tracking in `apps/web/src/app/components/posthog-click-tracker.tsx`
- Step 8 API analytics owner: keep server-side tracking aligned in `apps/api/src/modules/auth/auth.service.ts` and `apps/api/integration/analytics-tracking.integration.spec.ts`
- Story 0.7 Task 8 step 1 owner: shared flag keys, value kinds, and code defaults in `packages/config/src/flags.ts`
- Story 0.7 Task 8 step 2 owner: remote PostHog flag evaluation in `apps/api/src/posthog/posthog.service.ts`
- Story 0.7 Task 8 step 3 owner: request-time fallback order in `packages/config/src/flags.ts`
- Story 0.7 Task 8 step 4 owner: fallback cache warmup and refresh in `apps/api/src/modules/feature-flags/feature-flags.warmup.ts`
- Step 8 feature-flag coordination owner: connect the request path and persistence layer in `apps/api/src/modules/feature-flags/feature-flags.service.ts` and `apps/api/src/modules/feature-flags/feature-flags.repository.ts`

Tests that cover this step:

Shared contract and API unit tests:

- [`packages/api-client/testing/analytics-events.spec.ts`](../../packages/api-client/testing/analytics-events.spec.ts):
  keeps canonical event names, schemas, property normalization, identity rules, and validation boundaries in lockstep.
- [`packages/config/src/flags.spec.ts`](../../packages/config/src/flags.spec.ts):
  proves the typed flag registry and the remote, stored, and code default fallback order.
- [`apps/api/src/posthog/posthog.service.spec.ts`](../../apps/api/src/posthog/posthog.service.spec.ts):
  proves configured, unconfigured, boolean, and non-boolean PostHog flag responses.
- [`apps/api/src/modules/feature-flags/feature-flags.service.spec.ts`](../../apps/api/src/modules/feature-flags/feature-flags.service.spec.ts):
  proves live evaluation, stored fallback, type rejection, defaults, and fallback synchronization.
- [`apps/api/src/modules/feature-flags/feature-flags.repository.spec.ts`](../../apps/api/src/modules/feature-flags/feature-flags.repository.spec.ts):
  proves cached flag reads, missing and null fallback values, and atomic multi-flag synchronization.
- [`apps/api/src/modules/feature-flags/feature-flags.warmup.spec.ts`](../../apps/api/src/modules/feature-flags/feature-flags.warmup.spec.ts):
  proves startup warmup and the five-minute fallback refresh hook.

Web and Mobile component tests:

- [`apps/web/src/app/components/analytics-event-actions.test.tsx`](../../apps/web/src/app/components/analytics-event-actions.test.tsx):
  proves CTA, upload, and alert tracking plus degraded polling and malformed payload behavior.
- [`apps/web/src/app/components/posthog-click-tracker.test.tsx`](../../apps/web/src/app/components/posthog-click-tracker.test.tsx):
  proves attribute-driven click capture and ignores elements without a declared event.
- [`apps/mobile/src/analytics/mobile-analytics.test.tsx`](../../apps/mobile/src/analytics/mobile-analytics.test.tsx):
  proves the repository analytics facade, identity normalization, provider wrapper, and hook adapter.
- [`apps/mobile/src/config/posthog.test.ts`](../../apps/mobile/src/config/posthog.test.ts):
  proves disabled-client behavior, default hosting, configuration warnings, and batched retry settings.

Integration test:

- [`apps/api/integration/analytics-tracking.integration.spec.ts`](../../apps/api/integration/analytics-tracking.integration.spec.ts):
  proves authenticated guardian and moderation tracking boundaries over HTTP.

Playwright browser tests:

- [`playwright/tests/home-analytics-capture.spec.ts`](../../playwright/tests/home-analytics-capture.spec.ts):
  proves browser-side home analytics capture through the user-facing surface.
- [`playwright/tests/home-analytics-resilience.spec.ts`](../../playwright/tests/home-analytics-resilience.spec.ts):
  proves primary, wardrobe, and community interactions stay usable when event polling returns a temporary failure.

Architecture diagram:

```mermaid
flowchart TD
  web["Web tracking actions"] --> contracts["Analytics contracts\nZod schemas and event names"]
  mobile["Mobile tracking wrappers"] --> contracts
  api_services["API tracking services auth and moderation"] --> contracts
  contracts --> wrappers["Track helpers\nsnake_case mapping"]
  wrappers --> ph_preview["PostHog Preview project"]
  wrappers --> ph_prod["PostHog Production project"]
  tests["Analytics integration tests"] --> contracts
  tests --> wrappers
```

## Step 9: Observability bootstrap with OpenTelemetry

User/business impact:

Starting OpenTelemetry with the process gives visibility into startup and request paths, so user-facing issues are found and diagnosed faster.
Standard traces and metrics in one backend cut downtime and MTTR.

Key takeaways:

1. OpenTelemetry starts before the Nest app is created, so startup and request paths are instrumented from the first tick.
2. The bootstrap no-ops safely when `GRAFANA_OTLP_ENDPOINT`, `GRAFANA_INSTANCE_ID`, or `GRAFANA_API_KEY` is missing, when `NODE_ENV=test` or `OTEL_SDK_DISABLED=true` is set, or when the SDK already started.
3. The API reads root `.env.local`, `.env.preview` / `.env.prod`, and `.env` before OTEL starts, so env changes need a full API restart.
   Hosted Vercel deployments do not read those repo files at runtime; set the values in the Vercel project's environment variables.
4. Set a stable OpenTelemetry `service.name` so Grafana shows `couturecast-api`; the default is `unknown_service:node`.
5. The setup stays vendor-neutral: W3C trace propagation, Node auto-instrumentations, and OTLP exporters stream metrics and traces to Grafana with little app-level coupling.

Story/Task mapping:

- Story 0.7
- Task 4 (OpenTelemetry setup in NestJS)

Story reference:

- `_bmad-output/implementation-artifacts/0-7-configure-posthog-opentelemetry-and-grafana-cloud.md`

Cross-links:

- Step 7 carries the required OTLP credentials into CI and hosted environments.
- Step 10 consumes the traces and metrics emitted here.
- Step 11 layers structured logs on the same observability foundation.

Sequence to follow:

1. Load the OTLP credential and env-loading rules first.
2. Read the instrumentation bootstrap before `main.ts` so the startup order stays clear.
3. Verify the guardrails and tests before relying on hosted telemetry.

Task owner map:

- Story 0.7 Task 4 step 1 owner: define OTLP backend endpoint + auth resolution in `apps/api/src/instrumentation.ts`
- Story 0.7 Task 4 step 2 owner: create OTLP exporters for traces and metrics in `apps/api/src/instrumentation.ts`
- Story 0.7 Task 4 step 3 owner: enable instrumentation + W3C propagation in `apps/api/src/instrumentation.ts`
- Story 0.7 Task 4 step 4 owner: initialize the SDK before app bootstrap in `apps/api/src/instrumentation.ts`
- Step 9 bootstrap order owner: preserve pre-Nest startup ordering in `apps/api/src/main.ts`
- Step 9 env-loading owner: keep root env loading aligned with OTEL startup in `apps/api/src/load-env.ts`
- Step 9 verification owner: validate instrumentation and env-loading behavior in `apps/api/src/instrumentation.spec.ts` and `apps/api/src/load-env.spec.ts`

Tests that cover this step:

Bootstrap unit tests:

- [`apps/api/src/instrumentation.spec.ts`](../../apps/api/src/instrumentation.spec.ts):
  proves OTLP credential resolution, exporter URLs, diagnostics, stable resources, W3C propagation, and one-time startup behavior.
- [`apps/api/src/load-env.spec.ts`](../../apps/api/src/load-env.spec.ts):
  proves development, local-test, and production environment-file precedence before telemetry bootstrap.

Integration test:

- [`apps/api/integration/observability.integration.spec.ts`](../../apps/api/integration/observability.integration.spec.ts):
  proves an instrumented API exports an OTLP trace to the configured collector endpoint.

Architecture diagram:

```mermaid
flowchart TD
  env["Process env"] --> skip{"Test env, SDK disabled, or already initialized?"}
  skip -- Yes --> noop["Skip OTEL bootstrap"]
  skip -- No --> creds{"OTLP endpoint, instance ID, and token present?"}
  creds -- No --> noop
  creds -- Yes --> cfg["Build OTLP exporter config"]
  cfg --> exporters["Create trace and metric exporters"]
  exporters --> sdk_cfg["Configure NodeSDK with W3C trace context"]
  sdk_cfg --> start["initializeOpenTelemetry()"]
  start --> nest["Bootstrap Nest app"]
  nest --> app["Handle HTTP requests and worker activity"]
  app --> otlp["Export spans and metrics via OTLP"]
  otlp --> grafana["GRAFANA_OTLP_ENDPOINT"]
  start --> tests["instrumentation.spec.ts validates init behavior"]
```

## Step 10: Grafana Cloud setup, telemetry inventory, and dashboard planning

User/business impact:

A Grafana Cloud stack gives the team one shared place to see the traces and metrics the API's OpenTelemetry setup emits.
That speeds up debugging and makes rollout decisions safer.

Key takeaways:

1. Grafana Cloud account setup is part of the implementation.
   Without a stack and OTLP credentials, the API's OpenTelemetry bootstrap quietly does nothing.
2. The repo uses three exact env var names for Grafana OTLP setup:
   `GRAFANA_OTLP_ENDPOINT`, `GRAFANA_INSTANCE_ID`, and `GRAFANA_API_KEY`.
3. Use those same three names in the local root env files, the GitHub Actions repository secrets, and the Vercel API project env vars, so local, CI, Preview, and Production all read the same contract.
4. Grafana Cloud usually provisions the core data sources already: Tempo (traces), Loki (logs), and Prometheus/Mimir (metrics).
   It may also add Grafana-managed sources such as alert history, profiles, or usage views.
   On first setup, check those built-in data sources before creating duplicates.
5. Dashboard work starts with a telemetry inventory.
   Use the Prometheus metric browser/selector to record what actually exists under prefixes like `http`, `nodejs`, and `v8js` before writing PromQL.
6. If queue, cache, socket, or database metrics are not instrumented yet, use a `Text` panel that says so.
   An empty chart implies coverage the repo does not have.
7. Manual Grafana verification starts with Tempo traces.
   Loki is not a required success signal yet because log ingestion is not wired.

Story/Task mapping:

- Story 0.7
- Task 6 (Grafana Cloud account setup)
- Task 6.5 (telemetry inventory before dashboards)
- Task 7 (Grafana dashboards built from real metrics)

Story reference:

- `_bmad-output/implementation-artifacts/0-7-configure-posthog-opentelemetry-and-grafana-cloud.md`

Cross-links:

- Step 9 is the source of the telemetry this step inspects.
- Step 11 adds correlated logs to the same operational picture.
- Step 7 is where these checks can later become stricter automation.

Sequence to follow:

1. Provision or verify the Grafana stack and OTLP credentials.
2. Confirm traces and real metric families from the local verification path.
3. Import dashboards only after the inventory matches what the repo actually emits.

Task owner map:

- Step 10 step 1 owner: emit traces and metrics toward Grafana Cloud in `apps/api/src/instrumentation.ts`
- Step 10 step 2 owner: provide the local verification endpoint in `apps/api/src/controllers/health.controller.ts`
- Step 10 step 3 owner: define the first queue-related telemetry inventory targets in `apps/api/src/config/queues.ts` and `apps/api/src/admin/admin.service.ts`
- Step 10 step 4 owner: define the realtime telemetry inventory target in `apps/api/src/modules/gateway/connection-manager.service.ts`
- Step 10 step 5 owner: keep local and hosted Grafana credentials aligned in `.env.local`, `.env.preview`, and `.env.prod`
- Step 10 support owner: document the manual verification workflow in `_bmad-output/project-knowledge/observability.md`

Tests that cover this step:

Integration test:

- [`apps/api/integration/observability.integration.spec.ts`](../../apps/api/integration/observability.integration.spec.ts):
  proves that an instrumented API exports OTLP traces to the configured collector endpoint.

Hosted Grafana stack creation, credentials, Explore checks, and dashboard building remain manual operational evidence.
The integration suite does not check the hosted dashboards.

Architecture diagram:

```mermaid
flowchart TD
  portal["Grafana Cloud Portal"] --> stack["Create stack couturecastobservability"]
  stack --> configure["Stack Configure page"]
  configure --> endpoint["Copy OTLP endpoint"]
  configure --> token["Create stack-scoped access policy token"]
  endpoint --> envfiles[".env.local .env.preview .env.prod"]
  id --> envfiles
  token --> envfiles
  endpoint --> gh["GitHub Actions secret: GRAFANA_OTLP_ENDPOINT"]
  id["GRAFANA_INSTANCE_ID"] --> gh2["GitHub Actions secret: GRAFANA_INSTANCE_ID"]
  token --> gh3["GitHub Actions secret: GRAFANA_API_KEY"]
  endpoint --> vercelPreview["Vercel Preview env vars<br/>mirrors .env.preview"]
  id --> vercelPreview
  token --> vercelPreview
  endpoint --> vercelProd["Vercel Production env vars<br/>mirrors .env.prod"]
  id --> vercelProd
  token --> vercelProd
  envfiles --> api["apps/api/src/instrumentation.ts"]
  gh --> ci["CI jobs"]
  gh2 --> ci
  gh3 --> ci
  api --> grafana["Grafana Explore: Tempo and Prometheus"]
```

## Step 11: API observability with structured logging

User/business impact:

Structured request logs tie every request to a request ID, user, feature area, and OpenTelemetry trace.
That speeds incident response and improves release confidence when diagnosing production failures across API, trace, and queue activity.

Key takeaways:

1. API logs emit stable JSON fields, including `timestamp`, `requestId`, `userId`, `feature`, `level`, and `message`.
   Those fields are part of the contract.
2. Request context lasts the whole request: middleware generates or reuses `x-request-id`, auth guards add `userId`, and later logs inherit that context.
3. The logger attaches the active OpenTelemetry span IDs, so logs and traces line up in Grafana.
4. Log level follows the environment: local defaults to `debug`, dev to `info`, and prod to `warn`.
5. Verification has two layers.
   Integration tests prove OTLP trace export and `requestId` log correlation locally.
   A manual Grafana check confirms the traces show up in Tempo on the hosted stack.
   Loki stays optional until log ingestion is wired.

Story/Task mapping:

- Story 0.7
- Task 5 (Pino structured logging)
- Task 10 (observability tests)

Story reference:

- `_bmad-output/implementation-artifacts/0-7-configure-posthog-opentelemetry-and-grafana-cloud.md`

Cross-links:

- Step 9 provides the trace context this logger attaches to.
- Step 10 is where those correlated traces and logs are inspected operationally.
- Step 7 is where observability verification can become a stronger gate over time.

Sequence to follow:

1. Start with log-level policy and the base logger shape.
2. Trace request ID and AsyncLocalStorage propagation.
3. Finish with the middleware and tests that prove log/trace correlation.

Task owner map:

- Story 0.7 Task 5 step 1 owner: resolve environment-driven log level policy in `apps/api/src/logger/pino.config.ts`
- Story 0.7 Task 5 step 2 owner: inject request + trace context via the shared logger mixin in `apps/api/src/logger/pino.config.ts`
- Story 0.7 Task 5 step 3 owner: keep the base logger reusable for HTTP middleware and feature-specific child loggers in `apps/api/src/logger/pino.config.ts`
- Step 11 request-context owner: handle request ID and AsyncLocalStorage propagation in `apps/api/src/logger/request-context.ts`
- Step 11 HTTP-boundary owner: apply the shared logger contract in `apps/api/src/logger/request-logger.middleware.ts`
- Step 11 verification owner: validate logger behavior and observability integration in `apps/api/integration/observability.integration.spec.ts`, `apps/api/src/logger/pino.config.spec.ts`, `apps/api/src/logger/request-context.spec.ts`, `apps/api/src/logger/request-logger.middleware.spec.ts`, and `packages/api-client/src/testing/observability-assertions.ts`

Tests that cover this step:

Logging unit tests:

- [`apps/api/src/logger/pino.config.spec.ts`](../../apps/api/src/logger/pino.config.spec.ts):
  proves environment log levels, trace correlation, structured fields, and redaction of upload credentials, paths, URLs, and image data.
- [`apps/api/src/logger/request-context.spec.ts`](../../apps/api/src/logger/request-context.spec.ts):
  proves request ID reuse and generation, feature inference, authenticated identity precedence, and async-context isolation.
- [`apps/api/src/logger/request-logger.middleware.spec.ts`](../../apps/api/src/logger/request-logger.middleware.spec.ts):
  proves lifecycle logs, response request IDs, normalized upload paths, and removal of query values.

Integration test:

- [`apps/api/integration/observability.integration.spec.ts`](../../apps/api/integration/observability.integration.spec.ts):
  proves emitted request logs keep the request ID across a real API request.

Architecture diagram:

```mermaid
flowchart LR
  client["Client request"] --> reqid["Request-context middleware<br/>generate or reuse x-request-id"]
  reqid --> httplog["pino-http middleware<br/>request_received / request_completed"]
  httplog --> nest["Nest guards + handlers"]
  nest --> auth["Auth guard enriches userId"]
  auth --> svc["Shared Pino logger in services"]
  svc --> trace["Active OTEL span context"]
  trace --> grafana["Grafana / OTLP correlation"]

  reqid --> context["AsyncLocalStorage request context"]
  context --> httplog
  context --> svc
```

## Step 12: Cross-surface E2E confidence

User/business impact:

Smoke E2E tests on web and mobile catch critical regressions before users hit them in production.
That allows more frequent releases with less manual QA and clear pass/fail evidence.

Key takeaways:

1. Playwright (`test:pw-local`) and Maestro (`test:mobile:e2e`) both run from shared root workspace scripts.
2. Each surface gets its own smoke checks: web checks API health, hero rendering, and accessibility; Playwright API specs check backend contracts at risky boundaries such as auth and moderation; mobile checks Expo launch/connect and basic tab navigation.
3. Playwright HTML reports and traces, plus Maestro screenshots and logs, speed up triage.
   Web is PR-gated; mobile stays manual and local by default.
4. `scripts/run-maestro.mjs` treats Expo Go as part of the harness: it resolves the active mobile target, waits for Expo Go on iOS when needed, and reuses a healthy Metro server before running Maestro.

Story/Task mapping:

- Story 0.13
- Task 1 (Playwright harness), Task 2 (Maestro harness), Task 4 (CI integration)

Story reference:

- `_bmad-output/implementation-artifacts/0-13-scaffold-cross-surface-e2e-automation.md`

Cross-links:

- Step 6 defines the realtime fallback behavior this step exercises.
- Step 7 connects these smoke flows to PR automation.

Sequence to follow:

1. Read the shared web and mobile harness config first.
2. Inspect the Playwright smoke specs and Maestro flow.
3. Trace how artifacts and CI wiring turn these runs into release confidence.

Task owner map:

- Step 12 step 1 owner: define shared Playwright harness behavior in `playwright/config/base.config.ts` and `playwright/config/local.config.ts`
- Step 12 step 2 owner: define the core web and API smoke flows in `playwright/tests/home.spec.ts`, `playwright/tests/web-health-sha.spec.ts`, `playwright/tests/api/auth-moderation-security.spec.ts`, and `playwright/tests/api/auth-signup-age-gate.spec.ts`
- Step 12 step 3 owner: define the mobile smoke flow in `maestro/sanity.yaml`
- Step 12 step 4 owner: orchestrate the mobile test harness in `scripts/run-maestro.mjs` and `scripts/start-mobile-server.sh`
- Step 12 step 5 owner: keep the mobile fallback runtime behavior aligned in `apps/mobile/src/realtime/mobile-fallback-controller.ts`
- Step 12 step 6 owner: connect web and mobile E2E execution to CI in `.github/workflows/pr-pw-e2e-local.yml` and `.github/workflows/pr-mobile-e2e.yml`

Tests that cover this step:

Playwright browser and API E2E tests:

- [`playwright/tests/home.spec.ts`](../../playwright/tests/home.spec.ts):
  proves the healthy Web hero renders and passes its accessibility scan.
- [`playwright/tests/web-health-sha.spec.ts`](../../playwright/tests/web-health-sha.spec.ts):
  proves deployed health and revision metadata.
- [`playwright/tests/api/auth-moderation-security.spec.ts`](../../playwright/tests/api/auth-moderation-security.spec.ts):
  proves missing-auth, role, actor-identity, and authorized-request boundaries for security-sensitive API routes.
- [`playwright/tests/api/auth-signup-age-gate.spec.ts`](../../playwright/tests/api/auth-signup-age-gate.spec.ts):
  proves the under-13 rejection, guardian-consent state, active-account state, and duplicate-email boundary over HTTP.

Mobile E2E test:

- [`maestro/sanity.yaml`](../../maestro/sanity.yaml):
  exercises the core mobile smoke path through the built application.

Current repo note:

- Playwright does two jobs: thin browser smoke for stable user-visible pages, and thin API contract checks for risky write paths.
  Copy the signup age-gate check in `playwright/tests/api/auth-signup-age-gate.spec.ts` when the real risk is backend policy enforcement.
- Keep browser E2E off scheduled backend state changes.
  When the risk sits at the Nest guard/controller boundary plus a cron-driven policy change, copy the guardian adulthood sweep in `apps/api/integration/guardian-emancipation.integration.spec.ts`.
  Without a deterministic trigger or injectable clock, browser tests there add more flake than signal.
- Keep these API specs stable over time and isolated: use dynamic dates for age boundaries, unique IDs or emails for create flows, and skip production for tests that mutate real state.

Architecture diagram:

```mermaid
flowchart LR
  trigger["Developer or CI run"] --> pick{"Select surface"}
  pick --> web_e2e["Web E2E test:pw-local"]
  pick --> mobile_e2e["Mobile E2E test:mobile:e2e or test:mobile:e2e:ios"]
  web_e2e --> web_server["Start API and Web test servers"]
  web_server --> web_smoke["Run Chromium smoke tests"]
  web_smoke --> web_artifacts["HTML report, traces, screenshots"]
  web_artifacts --> web_gate["PR gating checks"]
  mobile_e2e --> maestro_install["Install Maestro CLI"]
  maestro_install --> target["Resolve Android target or boot iOS simulator"]
  target --> metro["Start or reuse Metro / Expo Go session"]
  metro --> mobile_smoke["Run maestro sanity flow"]
  mobile_smoke --> mobile_artifacts["Maestro screenshots and logs"]
  mobile_artifacts --> mobile_policy["Local manual default, non gating CI"]
```

**Overall goal for Steps 13-15**

This is the contract loop the repo aims to enforce:

`Zod contracts -> inferred types + runtime validation + OpenAPI registration -> canonical spec -> live docs + generated SDK -> app usage`

CI runs beside this contract-authoring loop.
It regenerates derived artifacts, detects drift, and enforces the breaking-change policy automatically.

```mermaid
flowchart LR
  Z["Zod contracts"]
  T["Inferred types"]
  V["Runtime validation"]
  O["OpenAPI registration"]
  S["Canonical spec"]
  D["Live docs"]
  G["Generated SDK"]
  A["App usage"]
  C["CI automation / diff checks"]

  Z --> T
  Z --> V
  Z --> O
  O --> S
  S --> D
  S --> G
  G --> A
  C -. regenerate + verify .-> S
  C -. guardrail .-> G
```

## Step 13: Serve one canonical OpenAPI contract from the API boundary

User/business impact:

Frontend, mobile, CI, and the human docs should all see the same contract.
When the API serves one canonical contract, clients get fewer hidden drift bugs and a cleaner upgrade path.

Key takeaways:

1. `/api/v1/openapi.json` and `/api/docs` should be two views of the same contract.
2. The shared Zod modules own contract authoring, and the API app publishes their canonical contract.
3. `main.ts` decides when the OpenAPI surface attaches during bootstrap, and `openapi.ts` decides how the canonical contract is served or rendered.
4. Swagger UI can render the contract.
   Swagger decorators stay outside the permanent authoring model for public REST endpoints.
5. Verify with a parity test: the served `/api/v1/openapi.json` contract must match the canonical builder output.

Story/Task mapping:

- Story 0.9
- Task 4 (replace Swagger-authored live docs with the canonical contract output)
- Task 6 (add canonical contract parity tests for the live API)

Story reference:

- `_bmad-output/implementation-artifacts/0-9-initialize-openapi-spec-generation-and-api-client-sdk.md`

Cross-links:

- Step 2 clarifies why `apps/api/src/main.ts` is the API bootstrap boundary.
- Step 7 frames contract publication as part of the repo quality-gates story.
- Step 14 defines where contracts are authored.
- Step 15 shows how SDKs and apps consume the same published contract.

Sequence to follow:

1. Start from the canonical contract builder.
2. Trace how `main.ts` and `openapi.ts` publish JSON and rendered docs.
3. Verify parity between the published API contract and the canonical spec output.

Task owner map:

- Story 0.9 Task 1 step 3 owner: attach the OpenAPI publication seam during API bootstrap in `apps/api/src/main.ts`
- Story 0.9 Task 1 step 2 owner: serve or render the API-facing contract outputs in `apps/api/src/openapi.ts`
- Step 13 step 3 owner: assemble the canonical contract from shared Zod registrations in `packages/api-client/src/contracts/http/openapi.ts`
- Step 13 step 4 owner: write the canonical contract artifact to disk in `packages/api-client/scripts/generate-http-openapi.ts`
- Story 0.9 Task 1 step 5 owner: prove the published API contract surface in `apps/api/src/openapi.spec.ts`

Tests that cover this step:

API publication unit test:

- [`apps/api/src/openapi.spec.ts`](../../apps/api/src/openapi.spec.ts):
  proves the API serves the canonical contract-derived document, renders Swagger UI, and disables publication by default in production.

Integration test:

- [`apps/api/integration/http-contract-parity.integration.spec.ts`](../../apps/api/integration/http-contract-parity.integration.spec.ts):
  proves representative live API responses validate against the shared health, events, error, and user schemas.

Current repo note:

- `apps/api/src/openapi.ts` publishes the canonical document from `@couture/api-client/contracts/http` to both `/api/v1/openapi.json` and `/api/docs`.
  `apps/api/src/openapi.spec.ts` proves the served JSON equals the canonical builder output.
  Swagger remains only as the UI renderer.

Architecture diagram:

```mermaid
flowchart LR
  contracts["Shared Zod contracts"]
  builder["Canonical contract builder"]
  spec["Canonical spec file"]
  json["Published /api/v1/openapi.json"]
  docs["Rendered /api/docs"]
  parity["Parity tests"]

  contracts --> builder
  builder --> spec
  spec --> json
  spec --> docs
  parity --> spec
  parity --> json
```

## Step 14: Author public REST contracts in shared Zod modules

User/business impact:

For Couture Cast to be a reference-quality base, public REST contracts live in one shared contract layer that every runtime trusts.
Controllers, generated clients, and endpoint-specific DTOs all get their contract definitions from that layer.

Key takeaways:

1. The permanent order is: define Zod contracts, register them into OpenAPI, generate the canonical document, then derive SDKs and adapters from that output.
2. The shared contract package owns request schemas, response schemas, error envelopes, inferred TypeScript types, and OpenAPI metadata in one place.
3. Each contract slice keeps its schemas and path registration together, so the module that owns an endpoint also owns its OpenAPI description.
4. Nest controllers and services stay thin: parse inputs, shape outputs, and delegate real work.
   They are adapters.
5. The first migrated slice is the proof point.
   The architecture is done when every public REST endpoint used by web/mobile follows the same model.
6. Keep pure business-policy helpers out of the contract layer.
   Shared policy logic such as age calculation belongs in `packages/utils`; the contract layer still owns request/response schemas, inferred types, and OpenAPI metadata.

Story/Task mapping:

- Story 0.9
- Task 2 (establish the Zod-first contract foundation)
- Task 5 (finish migrating the remaining public REST slices)

Story reference:

- `_bmad-output/implementation-artifacts/0-9-initialize-openapi-spec-generation-and-api-client-sdk.md`

Cross-links:

- Step 2 explains why package boundaries matter before contract authoring starts.
- Step 13 shows how the API should publish the contract once it exists.
- Step 15 shows what happens downstream after the contract is validated.

Sequence to follow:

1. Start with reusable primitives before endpoint-specific schemas.
2. Register paths next to the schema definitions and compose them into one canonical builder.
3. Write and validate the canonical document before any downstream consumer uses it.
4. Keep Nest controllers and services thin; they import the shared schemas.

Task owner map:

- Story 0.9 Task 2 step 1 owner: define reusable HTTP primitives in `packages/api-client/src/contracts/http/common.ts`
- Story 0.9 Task 2 step 2 owner: define endpoint-specific health contracts in `packages/api-client/src/contracts/http/health.ts`
- Story 0.9 Task 2 step 3 owner: define endpoint-specific feature contracts in `packages/api-client/src/contracts/http/events.ts`
- Story 0.9 Task 2 step 4 owner: compose slice registrations into one canonical builder in `packages/api-client/src/contracts/http/openapi.ts`
- Story 0.9 Task 2 step 5 owner: write the canonical contract artifact to disk in `packages/api-client/scripts/generate-http-openapi.ts`
- Story 0.9 Task 2 step 6 owner: validate the canonical contract in `packages/api-client/testing/http-openapi.spec.ts`
- Story 0.9 Task 2 step 7 owner: consume the shared schemas from the API adapter boundary in `apps/api/src/contracts/http.ts`
- Story 0.9 Task 5 step 1 owner: define the shared auth REST contract slice in `packages/api-client/src/contracts/http/auth.ts`
- Story 0.9 Task 5 step 2 owner: define the shared moderation REST contract slice in `packages/api-client/src/contracts/http/moderation.ts`
- Story 0.9 Task 5 step 3 owner: define the first shared user REST contract slice in `packages/api-client/src/contracts/http/user.ts`
- Story 0.9 Task 5 step 4 owner: shape the DB-backed authenticated user profile through shared contracts in `apps/api/src/modules/user/user.service.ts`
- Story 0.9 Task 5 step 5 owner: expose the thin authenticated user REST adapter in `apps/api/src/modules/user/user.controller.ts`

Tests that cover this step:

Shared contract unit tests:

- [`packages/api-client/testing/http-openapi.spec.ts`](../../packages/api-client/testing/http-openapi.spec.ts):
  proves the contract builder emits valid OpenAPI and stays in sync with the checked-in canonical document.
- [`packages/api-client/testing/contract-invariants-documented.spec.ts`](../../packages/api-client/testing/contract-invariants-documented.spec.ts):
  proves runtime-only Zod refinements show up in the published OpenAPI descriptions.
- [`packages/api-client/testing/auth-contract.spec.ts`](../../packages/api-client/testing/auth-contract.spec.ts):
  proves strict signup, age-gate, response union, and guardian-consent contract boundaries.

API adapter unit tests:

- [`apps/api/src/modules/user/user.controller.spec.ts`](../../apps/api/src/modules/user/user.controller.spec.ts):
  proves profile reads and preference updates delegate through validated controller inputs.
- [`apps/api/src/modules/user/user.service.spec.ts`](../../apps/api/src/modules/user/user.service.spec.ts):
  proves shared response shaping, missing-profile behavior, and atomic locale preference merging.

Current repo note:

- Health, polling, auth, moderation, and the first authenticated user profile slice follow this model.
  The auth slice covers signup age verification and guardian consent.
  `packages/api-client/src/contracts/http/auth.ts` owns the public request/response contract, and `packages/utils/src/age.ts` owns the reusable age-policy calculation.
  Guardian invitation and revoke flows live in `packages/api-client/src/contracts/http/guardian.ts`, and the generated `packages/api-client/docs/http.openapi.json` publishes the matching `/api/v1/guardian/*` endpoints.
  Guardian-aware DB enforcement backs that contract path in `packages/db/prisma/migrations/20260420113000_add_guardian_shared_rls_policies/migration.sql`, including the Supabase-JWT-to-app-user bridge the repo's text `User.id` model needs.
  The revoke follow-up lives in `packages/db/prisma/migrations/20260421090000_block_revoked_teens_from_self_access/migration.sql`, with persona coverage in `packages/db/test/rls/`.
  The remaining work is to migrate later public REST endpoints as they land, so every web/mobile-facing API starts in the same shared-contract path.
  Task 6 showed that revoked-consent behavior at the Nest adapter boundary needed parity tests and runtime guard checks on top of the shared Zod modules.

Architecture diagram:

```mermaid
flowchart TD
  common["common.ts\nshared primitives"] --> health["health.ts\nendpoint schemas"]
  common --> events["events.ts\nendpoint schemas"]
  health --> registry["register*Contracts(...)"]
  events --> registry
  registry --> builder["OpenAPIRegistry + OpenApiGeneratorV31"]
  builder --> document["http.openapi.json"]
  health --> api["Nest adapters"]
  events --> api
```

## Step 15: Validate, generate, and consume the canonical contract

User/business impact:

Generated SDKs, CI diff checks, and real app usage turn the canonical contract into an enforced delivery boundary that every downstream consumer can trust.

Key takeaways:

1. SDK generation runs downstream, only after the canonical contract is generated and validated.
2. Root-level **npm scripts and the lockfile** drive contract regeneration, so developers and CI need no running API server.
   Regeneration is independent of npm hoisting of arbitrary packages.
3. The package's public API is a small human-written wrapper such as `createApiClient(...)` over the generated output.
   Each app wraps that again with its own runtime base URL and auth defaults.
4. CI breaking-change checks, live API parity tests, repo-level validation commands, and web/mobile runtime usage all depend on the same canonical spec file and normalized generated surface.
5. The contract loop closes when real app flows use the generated client for their request typing.

Story/Task mapping:

- Story 0.9
- Task 3 (generate SDK from the canonical contract-derived spec and add wrapper exports)
- Task 6 (add contract parity tests)
- Task 7 (integrate the generated SDK into real web/mobile flows)
- Task 8 (implement canonical OpenAPI diff checks in CI)
- Task 9 (document versioning and regeneration workflow)

Story reference:

- `_bmad-output/implementation-artifacts/0-9-initialize-openapi-spec-generation-and-api-client-sdk.md`

Cross-links:

- Step 13 explains how the API publishes the contract.
- Step 14 explains how the contract is authored.
- Step 7 frames CI automation here as part of the repo quality-gates model.

Sequence to follow:

1. Keep canonical spec generation and validation green first.
2. Generate and normalize the SDK from the checked-in canonical spec.
   This file-based input keeps generation independent of a live API URL.
3. Consume the stable wrapper surface from app-local factories, typed helpers, and tests.
4. Re-run repo-level `typecheck`, `lint`, and `test` after regeneration so generator drift is caught where real consumers compile.
5. Use CI only to regenerate, detect drift, and enforce contract guardrails.

Task owner map:

- Story 0.9 Task 3 step 1 owner: install and expose generator tooling from the repo root in `package.json` and `package-lock.json`
- Story 0.9 Task 3 step 2 owner: point the generator at the checked-in canonical spec in `openapitools.json`
- Story 0.9 Task 3 step 3 owner: normalize raw generated output and prune generator-only import noise in `packages/api-client/scripts/postprocess-generated-sdk.ts`
- Story 0.9 Task 3 step 4 owner: publish the stable human-authored client factory in `packages/api-client/src/client.ts`
- Step 15 step 4 owner: re-export the stable package surface in `packages/api-client/src/index.ts`
- Step 15 step 5 owner: validate the canonical spec before downstream consumption in `packages/api-client/testing/http-openapi.spec.ts`
- Story 0.9 Task 3 step 5 owner: prove the generated wrapper surface in `packages/api-client/testing/generated-client.spec.ts`
- Story 0.9 Task 7 step 1 owner: wrap the generated client for web runtime defaults in `apps/web/src/lib/api-client.ts`
- Story 0.9 Task 7 step 2 owner: wrap the generated client for mobile runtime defaults in `apps/mobile/src/lib/api-client.ts`
- Story 0.9 Task 7 step 3 owner: route web polling through the generated client in `apps/web/src/lib/events-client.ts`
- Story 0.9 Task 7 step 4 owner: consume generated polling in the web analytics runtime flow in `apps/web/src/app/components/analytics-event-actions.tsx`
- Story 0.9 Task 7 step 5 owner: route mobile API health checks through the generated client in `apps/mobile/src/lib/api-health.ts`
- Story 0.9 Task 7 step 6 owner: consume generated-client health state in the mobile tab runtime in `apps/mobile/app/(tabs)/two.tsx`

Tests that cover this step:

Contract generation unit tests:

- [`packages/api-client/testing/http-openapi.spec.ts`](../../packages/api-client/testing/http-openapi.spec.ts):
  proves canonical document validity and checked-in artifact sync.
- [`packages/api-client/testing/generated-client.spec.ts`](../../packages/api-client/testing/generated-client.spec.ts):
  proves the stable generated-client factory, configuration overrides, token handling, and authenticated generated methods.
- [`apps/api/src/openapi.spec.ts`](../../apps/api/src/openapi.spec.ts):
  proves the API-published document equals the canonical builder output.

Integration test:

- [`apps/api/integration/http-contract-parity.integration.spec.ts`](../../apps/api/integration/http-contract-parity.integration.spec.ts):
  proves representative live routes return bodies the shared schemas accept.

Web and Mobile client tests:

- [`apps/web/src/lib/api-client.test.ts`](../../apps/web/src/lib/api-client.test.ts):
  proves public-base-URL and same-origin Web client defaults.
- [`apps/mobile/src/lib/api-client.test.ts`](../../apps/mobile/src/lib/api-client.test.ts):
  proves Mobile base-URL selection, explicit overrides, bearer-token forwarding, and missing-configuration rejection.
- [`apps/mobile/src/lib/api-health.test.ts`](../../apps/mobile/src/lib/api-health.test.ts):
  proves Mobile health loading through the generated client.
- [`apps/mobile/src/screens/tab-two-screen.test.tsx`](../../apps/mobile/src/screens/tab-two-screen.test.tsx):
  proves the Settings surface renders generated-client health data and its unavailable fallback.
- [`apps/mobile/components/msw-network.test.tsx`](../../apps/mobile/components/msw-network.test.tsx):
  proves generated client consumers can use default and per-test MSW network handlers.

Current repo note:

- The repo enforces the contract in four layers.
  They are package-level builder validation and checked-in spec sync in `packages/api-client/testing/http-openapi.spec.ts`, API-published OpenAPI parity in `apps/api/src/openapi.spec.ts`, representative API integration parity in `apps/api/integration/http-contract-parity.integration.spec.ts`, and thin live-endpoint smoke in `playwright/tests/api/*.spec.ts`, including signup age-gate coverage.
  The SDK postprocess step strips unused generated model imports, so repo-level `npm run typecheck`, `npm run lint`, and `npm run test` stay green after regeneration.
  Task 7 landed app-local SDK factories and real web/mobile runtime consumers, so the generated surface now reaches production-facing paths.
  The remaining work is CI diff enforcement and the versioning/regeneration documentation closeout.

Architecture diagram:

```mermaid
flowchart TD
  spec["Canonical spec\nhttp.openapi.json"] --> validate["Spec validation"]
  validate --> sdk["OpenAPI Generator"]
  sdk --> normalize["Postprocess + wrapper exports"]
  normalize --> apps["Web / mobile consumers"]
  spec --> parity["Live API parity tests"]
  spec --> diff["CI breaking-change diff"]
  parity --> apps
  diff --> apps
```

## Step 16: Weather API ingestion service and durable worker ingestion

User/business impact:

CoutureCast's outfit guidance depends on accurate current and hourly weather updated in real time.
Swappable providers, transactional persistence, bounded failover, and durable worker scheduling keep that guidance useful when a provider is slow, rate-limited, or down.

Key takeaways:

1. One shared interface (`IWeatherProvider`) keeps the worker orchestrator free of provider-specific quirks.
2. Provider responses are parsed and strictly validated with Zod before normalization.
   Invalid payloads are rejected whole, so no partial or corrupt state gets persisted.
3. Coordinates are rounded to a fixed precision (e.g., 4 decimal places) at the provider boundary so cache keys and lookups stay consistent.
   Raw coordinates and API keys are scrubbed from errors and logs to protect user privacy.
4. Normalized snapshots and exactly 48 hourly forecast segments are persisted in one transaction, with a location/provider/provider-update uniqueness key so repeated worker attempts are idempotent.
5. The ingestion service owns bounded provider retries, and BullMQ location jobs run with a single attempt.
   The service makes three primary attempts for timeouts and retryable HTTP failures, fails over immediately on `429`, and makes one secondary attempt before fallback.
6. Latest-weather reads return one of four freshness states: `fresh`, `cached`, `stale`, or `unavailable`, with the exact 60-minute boundary and user-safe fallback messages.
7. Durable scheduling belongs to BullMQ 5 Job Schedulers in the standalone worker runtime.
   Periodic ingestion requires a durable runtime beyond the lifetime of Vercel HTTP instances.
8. The public read surface is contract-first: `GET /api/v1/weather/{locationKey}` returns the shared `{ data }` latest-weather union, and the generated SDK exposes `WeatherApi`.
9. Operational weather telemetry goes exclusively to OpenTelemetry/Grafana.
   Weather telemetry uses bounded provider/outcome/status attributes and carries no coordinates, raw payloads, provider keys, or user identifiers.
10. At a 30-minute cadence, each canonical target uses up to 48 primary forecast calls per day before retry or failover.
    Budget provider calls from that number.

Story/Task mapping:

- Story 1.1
- Task 1 (provider contracts, adapters, and configuration)
- Task 2 (normalized persistence model and shared fixtures)
- Task 3 (bounded provider orchestration and freshness fallback)
- Task 4 (durable scheduling, target fan-out, and real worker processor)
- Task 5 (canonical latest-weather read contract)
- Task 6 (privacy-safe operational telemetry)
- Task 7 (provider, persistence, scheduling, fallback, and telemetry proof)
- Task 8 (architecture and operational documentation)

Story reference:

- `_bmad-output/implementation-artifacts/1-1-weather-api-ingestion-service.md`

Cross-links:

- Step 3 frames weather snapshot and forecast segment database tables.
- Step 4 documents environment configuration loading.
- Step 5 details BullMQ worker concurrency and queuing defaults.
- Step 9 and Step 10 provide the OpenTelemetry/Grafana foundation that Task 6 extends with weather-specific metrics and alerts.
- Step 15 explains the OpenAPI and generated SDK flow used by Task 5.

Sequence to follow:

1. Define provider-agnostic interfaces and normalized data models.
2. Implement adapters for the primary (OpenWeather) and secondary (WeatherAPI) providers.
3. Handle vendor-specific unit normalization (e.g., wind speed in m/s) and time epoch parsing.
4. Persist validated normalized snapshots and all 48 hourly entries in one Prisma transaction.
5. Implement retry/failover and freshness fallback using injected providers, repository, clock, sleeper, logger, and meter.
6. Fan out canonical weather targets through BullMQ sweep and location jobs, using stable interval-bucketed job IDs.
7. Run the standalone worker runtime with `npm run start:workers:prod` in a non-serverless process group.
8. Write mock fixtures covering success, missing fields, 429 rate limit, 500 server error, and malformed responses.
9. Verify behavior with unit tests that block live network access.
10. Publish the latest-weather read contract through the canonical OpenAPI registry before controller code, then regenerate checked-in SDK artifacts.
11. Wire weather telemetry through stable log event names and OpenTelemetry counters/histograms, then back it with Grafana panels and alerting.
12. Keep provider-call budgets and rollback procedures in the worker runbook.

Task owner map:

- Story 1.1 Task 1 step 1 owner: define `IWeatherProvider` and normalized weather target/forecast types in `apps/api/src/modules/weather/providers/weather-provider.interface.ts` and `apps/api/src/modules/weather/providers/weather.types.ts`
- Story 1.1 Task 1 step 2 owner: implement the primary OpenWeather adapter in `apps/api/src/modules/weather/providers/openweather.provider.ts`
- Story 1.1 Task 1 step 3 owner: implement the secondary WeatherAPI adapter in `apps/api/src/modules/weather/providers/weatherapi.provider.ts`
- Story 1.1 Task 1 step 4 owner: validate provider payloads and normalized forecasts in `apps/api/src/modules/weather/providers/weather.schemas.ts`
- Story 1.1 Task 2 step 1 owner: model normalized weather snapshots and forecast segments in `packages/db/prisma/schema.prisma`
- Story 1.1 Task 2 step 2 owner: backfill and constrain normalized weather persistence in `packages/db/prisma/migrations/20260707104000_normalize_weather_persistence/migration.sql`
- Story 1.1 Task 2 step 3 owner: keep shared weather factories aligned with the migrated persistence shape in `packages/testing/src/factories/weather.factory.ts`
- Story 1.1 Task 2 step 4 owner: persist normalized snapshots and segments transactionally in `apps/api/src/modules/weather/weather.repository.ts`
- Story 1.1 Task 3 step 1 owner: implement bounded provider retry and failover in `apps/api/src/modules/weather/weather-ingestion.service.ts`
- Story 1.1 Task 3 step 2 owner: classify latest-weather freshness and fallback responses in `apps/api/src/modules/weather/weather-query.service.ts`
- Story 1.1 Task 4 step 1 owner: load configured bootstrap ingestion targets in `apps/api/src/modules/weather/weather-target-source.ts`
- Story 1.1 Task 4 step 2 owner: coalesce targets and enqueue interval-bucketed location jobs in `apps/api/src/modules/weather/weather-processor.ts`
- Story 1.1 Task 4 step 3 owner: register the durable BullMQ weather sweep scheduler in `apps/api/src/modules/weather/weather-scheduler.ts`
- Story 1.1 Task 4 step 4 owner: wire the real weather worker processor and scheduler startup in `apps/api/src/workers/bootstrap.ts`
- Story 1.1 Task 4 step 5 owner: document the non-serverless weather worker runtime in `apps/api/README.md`
- Story 1.1 Task 5 step 1 owner: define the shared latest-weather HTTP contract in `packages/api-client/src/contracts/http/weather.ts`
- Story 1.1 Task 5 step 2 owner: register `GET /api/v1/weather/{locationKey}` in `packages/api-client/src/contracts/http/openapi.ts`
- Story 1.1 Task 5 step 3 owner: expose the authenticated weather read adapter in `apps/api/src/modules/weather/weather.controller.ts` and `weather.module.ts`
- Story 1.1 Task 6 step 1 owner: define privacy-safe weather metrics and log events in `apps/api/src/modules/weather/weather-telemetry.ts`
- Story 1.1 Task 6 step 2 owner: dashboard and alert evidence lives in `infra/grafana/dashboards/couturecast-weather-ingestion.json`
- Story 1.1 Task 7 step 1 owner: weather API integration proof lives in `apps/api/integration/weather.integration.spec.ts`

Tests that cover this step:

Shared contract and fixture unit tests:

- [`packages/api-client/testing/weather-contract.spec.ts`](../../packages/api-client/testing/weather-contract.spec.ts):
  proves the latest-weather success and freshness union plus authenticated OpenAPI route registration.
- [`packages/testing/test/weather.factory.spec.ts`](../../packages/testing/test/weather.factory.spec.ts):
  proves 48-hour fixture shape, caller-supplied segments, alert JSON, persistence, and cleanup registration.

Provider, service, repository, and worker unit tests:

- [`apps/api/src/modules/weather/providers/openweather.provider.spec.ts`](../../apps/api/src/modules/weather/providers/openweather.provider.spec.ts):
  proves normalization, validation, retry classifications, privacy-safe failures, and location matching for OpenWeather.
- [`apps/api/src/modules/weather/providers/weatherapi.provider.spec.ts`](../../apps/api/src/modules/weather/providers/weatherapi.provider.spec.ts):
  proves the same adapter boundaries for WeatherAPI, including missing and malformed forecast horizons.
- [`apps/api/src/modules/weather/providers/weather.config.spec.ts`](../../apps/api/src/modules/weather/providers/weather.config.spec.ts):
  proves typed provider settings, validated canonical targets, and safe defaults.
- [`apps/api/src/modules/weather/providers/weather-condition.mapper.spec.ts`](../../apps/api/src/modules/weather/providers/weather-condition.mapper.spec.ts):
  proves condition and severity normalization across provider payloads.
- [`apps/api/src/modules/weather/weather-ingestion.service.spec.ts`](../../apps/api/src/modules/weather/weather-ingestion.service.spec.ts):
  proves bounded primary retries, failover, cached fallback, abort handling, and privacy-safe logs and metrics.
- [`apps/api/src/modules/weather/weather.repository.spec.ts`](../../apps/api/src/modules/weather/weather.repository.spec.ts):
  proves transactional snapshot and segment persistence, idempotency, race recovery, public reads, and provider state.
- [`apps/api/src/modules/weather/weather-query.service.spec.ts`](../../apps/api/src/modules/weather/weather-query.service.spec.ts):
  proves fresh, cached, stale, and unavailable classifications at their time boundary.
- [`apps/api/src/modules/weather/weather-target-source.spec.ts`](../../apps/api/src/modules/weather/weather-target-source.spec.ts):
  proves validated targets, cross-source deduplication, and saved-primary-location discovery.
- [`apps/api/src/modules/weather/weather-processor.spec.ts`](../../apps/api/src/modules/weather/weather-processor.spec.ts):
  proves stable bucketed job IDs, target coalescing, location processing, durable alert dispatch, and enqueue failure handling.
- [`apps/api/src/modules/weather/weather-scheduler.spec.ts`](../../apps/api/src/modules/weather/weather-scheduler.spec.ts):
  proves durable weather refresh and alert outbox scheduler registration.
- [`apps/api/src/modules/weather/weather.controller.spec.ts`](../../apps/api/src/modules/weather/weather.controller.spec.ts):
  proves authentication, canonical success and fallback envelopes, and invalid location rejection.
- [`apps/api/src/modules/weather/weather-telemetry.spec.ts`](../../apps/api/src/modules/weather/weather-telemetry.spec.ts):
  proves bounded provider, ingestion, rate-limit, fallback, and snapshot-age metrics.

Real PostgreSQL and HTTP integration tests:

- [`apps/api/integration/weather.integration.spec.ts`](../../apps/api/integration/weather.integration.spec.ts):
  proves transactional persistence, idempotency, concurrent-race recovery, authentication, and canonical HTTP response validation.

Current repo note:

- Story 1.1 is implemented through Task 8.
  The provider adapters produce one normalized forecast response, the Prisma model stores canonical snapshots and hourly segments, the ingestion service owns provider retry/failover, the standalone worker owns durable scheduling and target fan-out, and the public latest-weather read contract is available through the canonical OpenAPI/SDK pipeline.
- Weather telemetry flows through stable Pino event names and OpenTelemetry metrics, with a Grafana weather-ingestion dashboard and a five-minute provider error-rate alert above 2%.

Architecture diagram:

```mermaid
flowchart TD
  Scheduler["BullMQ Job Scheduler\nweather-refresh-sweep"] --> Sweep["Sweep processor"]
  Targets["ConfiguredWeatherTargetSource"] --> Sweep
  Sweep --> LocationJobs["Interval-bucketed location jobs\nattempts: 1"]
  LocationJobs --> Worker["Weather worker\nconcurrency <= 5"]

  Worker --> Ingestion["WeatherIngestionService"]
  Ingestion --> OpenWeather["OpenWeatherProvider\nprimary"]
  Ingestion --> WeatherApi["WeatherApiProvider\nsecondary"]
  OpenWeather --> Normalized["NormalizedWeatherForecast\n48 hourly entries"]
  WeatherApi --> Normalized
  Normalized --> Repository["WeatherRepository\ntransactional persistence"]
  Repository --> DB["WeatherSnapshot + ForecastSegment"]
  Repository --> Query["WeatherQueryService\nfresh/cached/stale/unavailable"]
```

## Step 17: Weather alert rules and notification pipeline

User/business impact:

Realtime and push alerts tell users right away about severe weather or a change in precipitation, so they can stay safe and adjust what they wear.
Quiet hours and duplicate suppression keep the alerts from turning into spam.

Key takeaways:

1. Alert rules (temperature delta, precipitation start, severe conditions) are stored per user and evaluated hourly after weather ingestion.
2. Ingestion writes triggered alerts to a transactional outbox (`AlertDeliveryOutbox`) linked to `EventEnvelope` with channel `alert:weather`, so the write is atomic before BullMQ fanout.
3. BullMQ `alert-fanout` workers handle delivery, checking notification preferences and active Socket.io sessions.
4. When the realtime publish succeeds (`realtime.published` is `true` via Redis relay channel `ALERT_WEATHER_RELAY_CHANNEL`), the push is suppressed so the user gets one alert.
5. Inactive or offline clients get an Expo Push API notification (batched, retried, invalid tokens pruned), unless local quiet hours or the duplicate check suppress it.
6. A manual DB-level cascade delete removes alert rules, preferences, and delivery rows when a user is deleted, so nothing is left behind.

Story/Task mapping:

- Story 1.3
- Task 1 (Prisma schema, migrations, and user preferences)
- Task 2 (Alerts API contracts and OpenAPI schemas)
- Task 3 (NestJS Alerts module API and RLS validation)
- Task 4 (Inconsistent database location field alignment)
- Task 5 (Weather alert processing and rule trigger engine)
- Task 6 (Quiet hours and push notification dispatch pipeline)
- Task 7 (Test coverage, worker integration, and validation)

Story reference:

- `_bmad-output/implementation-artifacts/1-3-alert-rules-notification-pipeline.md`

Cross-links:

- Step 3 frames the database schemas that alert rules and preferences extend.
- Step 5 defines the BullMQ concurrency policies the fanout queue uses.
- Step 6 covers the Socket.io and Expo Push infrastructure this pipeline drives.
- Step 15 explains the OpenAPI generated SDK client flow.

Sequence to follow:

1. Add the database models (`AlertRule`, `NotificationPreference`, `EventEnvelope`, `AlertDeliveryOutbox`, `AlertCooldownReservation`) with Cascade constraints and migrations.
2. Define Zod HTTP read/write contracts for alert rules and preferences, and generate the SDK.
3. Build the NestJS alerts API module, with RLS queries filtered by the authenticated `userId`.
4. Run the rule evaluation engine (`WeatherAlertProcessingService`) concurrently inside transactions, reserving rolling 1-hour cooldowns.
5. Build the BullMQ `alert-fanout` worker, which checks timezone-aware quiet hours start/end boundaries with cached DateTimeFormatters.
6. Relay socket events over namespace `/alert:weather` with Redis Pub/Sub, and suppress the push when the realtime publish succeeds.
7. Add test cleanup in the testing package that purges the temporary outbox and reservation tables.

Task owner map:

- Story 1.3 Task 1 step 1 owner: define Prisma models for alert rules and preferences in `packages/db/prisma/schema.prisma`
- Story 1.3 Task 1 step 2 owner: write manual migration for cascade deletion on user delete in `packages/db/prisma/migrations/20260713180000_cascade_delete_user_event_envelopes/migration.sql`
- Story 1.3 Task 2 step 1 owner: declare alerts HTTP schemas and routes in `packages/api-client/src/contracts/http/alerts.ts`
- Story 1.3 Task 3 step 1 owner: implement user alerts controllers and RLS repository queries in `apps/api/src/modules/alerts/alerts.controller.ts` and `apps/api/src/modules/alerts/alerts.repository.ts`
- Story 1.3 Task 5 step 1 owner: evaluate temperature, precipitation, and severe alert rules in `apps/api/src/modules/alerts/weather-alert-evaluator.ts`
- Story 1.3 Task 5 step 2 owner: orchestrate weather alert processing and BullMQ dispatch in `apps/api/src/modules/alerts/weather-alert-processing.service.ts`
- Story 1.3 Task 6 step 1 owner: implement quiet-hours checks using cached formatters in `apps/api/src/modules/alerts/quiet-hours.ts`
- Story 1.3 Task 6 step 2 owner: execute realtime relay, push suppression, and Expo dispatch in `apps/api/src/modules/alerts/alert-fanout.processor.ts`
- Story 1.3 Task 6 step 3 owner: broadcast realtime updates over `/alert:weather` in `apps/api/src/modules/gateway/gateway.gateway.ts`
- Story 1.3 Task 7 step 1 owner: clean up event envelopes and alert tables on teardown in `packages/testing/src/cleanup.ts`
- Story 1.3 Task 7 step 2 owner: verify realtime push suppression and quiet hours boundaries in `apps/api/src/modules/alerts/alert-fanout.processor.spec.ts`

Tests that cover this step:

Database structure and security tests:

- [`packages/db/test/alert-schema.spec.ts`](../../packages/db/test/alert-schema.spec.ts):
  proves user-owned alert rule and preference models, constraints, opt-out storage, and self-only RLS migration shape.
- [`packages/db/test/alert-outbox-schema.spec.ts`](../../packages/db/test/alert-outbox-schema.spec.ts):
  proves durable queue handoff state, rolling cooldown reservations, and rule-specific database thresholds.
- [`packages/db/test/alert-delivery-security.spec.ts`](../../packages/db/test/alert-delivery-security.spec.ts):
  proves self-only push tokens, owned or global event reads, and worker-only cooldown reservations in migration SQL.

Shared contract and fixture unit tests:

- [`packages/api-client/testing/alerts-contract.spec.ts`](../../packages/api-client/testing/alerts-contract.spec.ts):
  proves strict alert rule and preference HTTP contracts plus canonical OpenAPI registration.
- [`packages/testing/test/alert.factory.spec.ts`](../../packages/testing/test/alert.factory.spec.ts):
  proves valid alert fixtures and persistence cleanup.

API pipeline unit and repository tests:

- [`apps/api/src/modules/alerts/weather-alert-evaluator.spec.ts`](../../apps/api/src/modules/alerts/weather-alert-evaluator.spec.ts):
  proves temperature, precipitation, severe-weather, change, and non-match rule evaluation.
- [`apps/api/src/modules/alerts/alerts.controller.spec.ts`](../../apps/api/src/modules/alerts/alerts.controller.spec.ts):
  proves authenticated, validated rule and preference controller flows.
- [`apps/api/src/modules/alerts/alerts.service.spec.ts`](../../apps/api/src/modules/alerts/alerts.service.spec.ts):
  proves rule and preference orchestration.
- [`apps/api/src/modules/alerts/alerts.repository.spec.ts`](../../apps/api/src/modules/alerts/alerts.repository.spec.ts):
  proves owner-scoped rule and preference persistence.
- [`apps/api/src/modules/alerts/quiet-hours.spec.ts`](../../apps/api/src/modules/alerts/quiet-hours.spec.ts):
  proves timezone-aware quiet-hour boundaries.
- [`apps/api/src/modules/alerts/weather-alert-processing.service.spec.ts`](../../apps/api/src/modules/alerts/weather-alert-processing.service.spec.ts):
  proves evaluation, transactional outbox creation, cooldown handling, and queue dispatch orchestration.
- [`apps/api/src/modules/alerts/weather-alert-processing.repository.spec.ts`](../../apps/api/src/modules/alerts/weather-alert-processing.repository.spec.ts):
  proves alert envelope, outbox, and cooldown persistence behavior.
- [`apps/api/src/modules/alerts/weather-alert-fanout.queue.spec.ts`](../../apps/api/src/modules/alerts/weather-alert-fanout.queue.spec.ts):
  proves stable fanout job identity and queue options.
- [`apps/api/src/modules/alerts/alert-fanout.processor.spec.ts`](../../apps/api/src/modules/alerts/alert-fanout.processor.spec.ts):
  proves realtime-first delivery, push suppression, quiet hours, and Expo fallback.
- [`apps/api/src/modules/alerts/alert-fanout.repository.spec.ts`](../../apps/api/src/modules/alerts/alert-fanout.repository.spec.ts):
  proves outbox claim and delivery-state persistence.
- [`apps/api/src/modules/alerts/redis-alert-realtime.publisher.spec.ts`](../../apps/api/src/modules/alerts/redis-alert-realtime.publisher.spec.ts):
  proves Redis publication and failure handling for the alert relay.
- [`apps/api/src/modules/gateway/alert-weather-relay.service.spec.ts`](../../apps/api/src/modules/gateway/alert-weather-relay.service.spec.ts):
  proves Redis messages are validated and relayed only to their target user.
- [`apps/api/src/modules/gateway/gateway.gateway.spec.ts`](../../apps/api/src/modules/gateway/gateway.gateway.spec.ts):
  proves the static alert namespace and server-owned user room delivery.
- [`apps/api/src/modules/notifications/notifications.test.ts`](../../apps/api/src/modules/notifications/notifications.test.ts):
  proves batching, retries, timeouts, mixed Expo tickets, and provider failures.
- [`apps/api/src/modules/notifications/push-token.repository.spec.ts`](../../apps/api/src/modules/notifications/push-token.repository.spec.ts):
  proves user token lookup and invalid-token removal.

Real PostgreSQL integration tests:

- [`apps/api/integration/weather-alert-cooldown.integration.spec.ts`](../../apps/api/integration/weather-alert-cooldown.integration.spec.ts):
  proves cross-hour suppression, atomic admission under races, and reservation rollback.
- [`apps/api/integration/alerts.integration.spec.ts`](../../apps/api/integration/alerts.integration.spec.ts):
  proves HTTP settings persistence, bearer-token ownership, cross-owner isolation, and transactional rule-update rollback against PostgreSQL.
- [`apps/api/integration/alert-pipeline-latency.integration.spec.ts`](../../apps/api/integration/alert-pipeline-latency.integration.spec.ts):
  proves the instrumented alert pipeline stays within its declared latency test boundary.

Current repo note:

- Realtime Socket.io connections are scoped to the `/alert:weather` namespace.
  The push is suppressed with reason `realtime_active` when the realtime publish resolves successfully.
- Test cleanup purges `EventEnvelope`, `AlertDeliveryOutbox`, and `AlertCooldownReservation` so no database state carries over between runs.
- Mock token bypasses (like `test-token-` and `k6-`) work only in local and Vercel Preview environments (`TEST_ENV=local` or `VERCEL_ENV=preview`).
  They are disabled in production.
  Testing in production means signing in real registered accounts against the live Supabase instance to get valid JWT access tokens.

Architecture diagram:

```mermaid
flowchart TD
  Ingest["Weather Ingestion"] --> Process["WeatherAlertProcessingService"]
  Process --> Evaluate["WeatherAlertEvaluator\ndelta-temp, precip, severe"]
  Evaluate --> Outbox["Prisma Transaction\nEventEnvelope + AlertDeliveryOutbox"]
  Outbox --> Queue["BullMQ alert-fanout queue"]

  Queue --> Worker["AlertFanoutProcessor"]
  Worker --> Realtime["Socket Gateway\n/alert:weather namespace"]
  Realtime -->|success| Active["Realtime Published\nrealtimePublished: true"]
  Active -->|suppresses push| PushSuppressed["Push Delivery Suppressed\nreason: realtime_active"]

  Realtime -->|fail/inactive| Offline["Realtime Inactive\nrealtimePublished: false"]
  Offline --> QuietHours{"Within user quiet hours?\nminuteOfDayAt (cached)"}
  QuietHours -->|yes| PushQuiet["Push Delivery Suppressed\nreason: quiet_hours"]
  QuietHours -->|no| Expo["PushNotificationService\nExpo Push SDK"]
```

## Step 18: Telemetry and audit baseline

User/business impact:

Typed telemetry lets product and business track activation funnels (signup completion, outfit recommendation engagement) and operational reliability.
A local Postgres telemetry table serves as an audit log for key events, and an hourly job prunes rows older than 24 hours.
Postgres Row-Level Security (RLS) lets users read only their own events, while system processes can still write anonymous records.

Key takeaways:

1. Telemetry events (`profile_completed`, `first_outfit_generated`, `forecast_viewed`, `alert_sent`, `location_switched`, `api_error_occurred`) are defined as typed contracts in `@couture/api-client`.
2. `TelemetryService` writes each event to the local Postgres `telemetry_events` table and forwards it to PostHog via `AnalyticsClient`.
3. The database write and the PostHog capture run concurrently, and a failure in either is caught and logged so the user request carries on.
4. An advisory-lock transaction (`pg_advisory_xact_lock` on a hash of `userId`) stops concurrent recommendation triggers from double-counting first-outfit generation.
5. Inserts are guarded by split RLS policies: authenticated users can insert only rows matching their `user_id`, and a separate policy lets `service_role` insert anonymous or system telemetry with a null `user_id`.
6. An hourly cron task deletes local events older than 24 hours.

Story/Task mapping:

- Story 1.4
- Task 1 (Prisma schema, migrations, RLS, and service_role telemetry policies)
- Task 2 (Type-safe analytics event contracts and track wrappers)
- Task 3 (NestJS Telemetry service, retention scheduler, and error isolation)
- Task 4 (Feature module instrumentation: auth signup, weather views, alert dispatches, location switches)
- Task 5 (Global API exception filter route sanitization and error code mapping)
- Task 6 (Test suite coverage, mock protection, and RLS integration verification)

Story reference:

- `_bmad-output/implementation-artifacts/1-4-telemetry-audit-baseline.md`

Cross-links:

- Step 3 defines the database schema and RLS baseline this model extends.
- Step 7 covers the CI/CD pipeline that tests this module.
- Step 8 sets up the shared analytics contracts this telemetry service implements.
- Step 11 covers the NestJS global filters and structured logging.

Sequence to follow:

1. Create the `TelemetryEvent` model in Prisma, run migrations, and define RLS policies (including `service_role` insert grants).
2. Register the Zod schemas and track wrappers in `packages/api-client`.
3. Build the NestJS `TelemetryModule` and `TelemetryService` with concurrent database and PostHog writes.
4. Add the cron pruner that deletes events older than 24 hours.
5. Instrument the existing modules (auth, weather, location, alerts) and configure the global exception filter.
6. Verify RLS behavior and telemetry persistence with integration tests.

Task owner map:

- Story 1.4 Task 1 step 1 owner: define Prisma model for telemetry events in `packages/db/prisma/schema.prisma`
- Story 1.4 Task 1 step 2 owner: write manual migration for RLS policies and service role grants in `packages/db/prisma/migrations/20260714100000_add_telemetry_event/migration.sql`
- Story 1.4 Task 2 step 1 owner: declare telemetry event schemas and trackers in `packages/api-client/src/types/analytics-events.ts`
- Story 1.4 Task 3 step 1 owner: implement telemetry service database and PostHog concurrent delivery in `apps/api/src/modules/telemetry/telemetry.service.ts`
- Story 1.4 Task 3 step 2 owner: coordinate posthogService cleanup in worker shutdown routine in `apps/api/src/workers/bootstrap.ts`
- Story 1.4 Task 4 step 1 owner: integrate signup telemetry in `apps/api/src/modules/auth/auth.service.ts`
- Story 1.4 Task 5 step 1 owner: implement global api exception filter in `apps/api/src/filters/api-exception.filter.ts`
- Story 1.4 Task 6 step 1 owner: verify telemetry RLS policies for authenticated users and the service role in `packages/db/test/rls/telemetry.spec.ts`

Tests that cover this step:

Real PostgreSQL security integration tests:

- [`packages/db/test/rls/telemetry.spec.ts`](../../packages/db/test/rls/telemetry.spec.ts):
  proves authenticated-user and service-role telemetry policy boundaries against real PostgreSQL.
- [`packages/db/test/audit-log-immutability.spec.ts`](../../packages/db/test/audit-log-immutability.spec.ts):
  proves administrator-only audit reads and blocks direct update, delete, and truncate operations.

Shared telemetry contract unit test:

- [`packages/api-client/testing/analytics-events.spec.ts`](../../packages/api-client/testing/analytics-events.spec.ts):
  proves canonical telemetry event names, schemas, normalized properties, subject handling, and invalid-input rejection.

API unit tests:

- [`apps/api/src/modules/telemetry/telemetry.service.spec.ts`](../../apps/api/src/modules/telemetry/telemetry.service.spec.ts):
  proves independent database and PostHog delivery, strict event mapping, pseudonymous garment telemetry, and 24-hour pruning.
- [`apps/api/src/filters/api-exception.filter.spec.ts`](../../apps/api/src/filters/api-exception.filter.spec.ts):
  proves exception telemetry extraction, normalized routes, safe degradation, and continued HTTP responses during telemetry failure.

Current repo note:

- Telemetry calls are fire-and-forget.
  Callers check `telemetryPromise !== undefined` first, so tests with stubbed or unmocked services do not crash.
- RLS tests check that a standard user cannot insert telemetry under another user's ID or with a null user ID.
  The backend `service_role` can still insert anonymous metrics.

Architecture diagram:

```mermaid
flowchart TD
  Trigger["Feature Trigger\nsignup, weather, alert, exception"] --> Service["TelemetryService"]
  Service -->|concurrent| DB["Postgres DB\ntelemetry_events table"]
  Service -->|concurrent| PH["PostHog Service\nanalyticsClient.capture"]
  DB -->|hourly prune| Pruner["Prune Scheduler\ndelete older than 24h"]
  RLS{"Row Level Security"} -->|authenticated| UserOnly["Insert allowed only if user_id = auth.uid()"]
  RLS -->|service_role| AnonAllowed["Insert allowed with NULL user_id"]
```

## Step 19: Scenario outfit generator

User/business impact:

The ritual endpoint returns three outfit cards (morning, midday, evening) per requested day.
Each card matches the forecast segment, the user's comfort preferences, and the user's real wardrobe.
Users get an outfit for each part of the day without browsing, and the business gets the daily personalization loop that drives engagement.
Matching the user's wardrobe to each forecast segment distinguishes Couture Cast from generic weather apps.

Key takeaways:

1. The shared Zod contract comes first: `ritualResponseSchema` and `ritualQueryParamsSchema` live in `@couture/api-client`, so web, mobile, and API share one validated shape, and the SDK and OpenAPI spec are regenerated from them.
2. Forecast hours are resolved in the location's IANA timezone (8 AM, 1 PM, 7 PM local) against the active weather snapshot.
   These slots follow the local wall clock, with the location's UTC offset applied when matching forecast hours.
3. Effective feels-like temperature shifts ±3°C for users who run cold or warm.
   Category rules (Outerwear / Top+Bottom+Shoes / Dress+Shoes) then pick from real garments, with typed placeholders when the closet is empty.
4. Redis is checked for `ritual:{userId}:{locationKey}` before any DB or algorithm work; a hit skips everything and returns in sub-millisecond time.
5. `OutfitRecommendation` rows are looked up by `(user_id, forecast_segment_id, scenario)` before creation, which prevents duplicates without a unique constraint.
6. TypeScript's control-flow narrowing fails when a variable is reassigned inside a conditional block.
   Declaring the outer variable as `OutfitRecommendation | null` and adding a non-null assertion after creation fixes it.
7. The `@typescript-eslint/no-unsafe-*` rules require test mocks to use explicit intermediate type casts.
   Tests assert on the mock variable directly, which avoids unbound-method warnings from reading a property off a mocked service.

Story/Task mapping:

- Story 2.1
- Task 1 (Zod HTTP contract + SDK regeneration)
- Task 2 (RitualController + module scaffold)
- Task 3 (RitualService algorithm + DB persistence)
- Task 4 (Redis caching layer)
- Task 5 (unit + integration test suite)

Story reference:

- `_bmad-output/implementation-artifacts/2-1-scenario-outfit-generator.md`

Cross-links:

- Step 3 defines the `OutfitRecommendation` and `ForecastSegment` Prisma models used here.
- Step 4 explains the Supabase environment behind this service's Prisma client.
- Step 5 explains the Redis/BullMQ infrastructure behind the caching layer.
- Step 8 sets the api-client contract conventions this step follows.
- Step 17 shows the `WeatherQueryService` and timezone lookups reused here.
- Step 18 shows the `TelemetryService` that later stories can wire into the ritual response path.

Sequence to follow:

1. Read `packages/api-client/src/contracts/http/ritual.ts` for the shared Zod schemas, and run `npm run generate:api-client` to see the SDK regenerate.
2. Open `apps/api/src/modules/personalization/ritual.controller.ts` to see query params parsed, Zod errors mapped to `BadRequestException`, and the response validated before it returns.
3. Read the `getOrCreateRitual` method in `apps/api/src/modules/personalization/ritual.service.ts`.
   It runs in this order: cache check, weather snapshot, segment lookup, comfort prefs, garment fetch, algorithm, DB upsert, cache write.
4. Trace the garment-matching block for the category composition rules and the placeholder path when the closet is empty.
5. Read `apps/api/src/modules/personalization/ritual.service.spec.ts` for unit coverage of the algorithm (cold/warm offsets, fallback, badge mapping, segment finder).
6. Read `apps/api/src/modules/personalization/ritual.controller.spec.ts` for integration coverage of auth guards, the Redis cache lifecycle, and DB persistence.

Task owner map:

- Story 2.1 Task 1 step 1 owner: define Zod request/response schemas for the ritual endpoint in `packages/api-client/src/contracts/http/ritual.ts`
- Story 2.1 Task 1 step 2 owner: register the ritual contract in the api-client barrel in `packages/api-client/src/contracts/http/index.ts`
- Story 2.1 Task 1 step 3 owner: re-export ritual contracts into the API workspace in `apps/api/src/contracts/http.ts`
- Story 2.1 Task 2 step 1 owner: scaffold the NestJS personalization module in `apps/api/src/modules/personalization/personalization.module.ts`
- Story 2.1 Task 2 step 2 owner: implement the ritual GET route with Zod-validated query and response in `apps/api/src/modules/personalization/ritual.controller.ts`
- Story 2.1 Task 3 step 1 owner: implement the full recommendation algorithm with DB persistence in `apps/api/src/modules/personalization/ritual.service.ts`
- Story 2.1 Task 4 step 1 owner: add Redis cache check and write with 15-minute TTL to RitualService in `apps/api/src/modules/personalization/ritual.service.ts`
- Story 2.1 Task 5 step 1 owner: unit-test the algorithm, fallbacks, badges, and segment resolution in `apps/api/src/modules/personalization/ritual.service.spec.ts`
- Story 2.1 Task 5 step 2 owner: integration-test the controller, Redis lifecycle, and DB persistence in `apps/api/src/modules/personalization/ritual.controller.spec.ts`

Tests that cover this step:

Shared contract and fixture unit tests:

- [`packages/api-client/testing/ritual-contract.spec.ts`](../../packages/api-client/testing/ritual-contract.spec.ts):
  proves exactly one outfit per scenario, strict scenario and query values, badge bullet requirements, and optional capsule attribution.
- [`packages/testing/test/ritual.factory.spec.ts`](../../packages/testing/test/ritual.factory.spec.ts):
  proves scenario fixtures, reasoning badge shape, optional forecast links, persistence, and cleanup registration.

API unit tests:

- [`apps/api/src/modules/personalization/ritual.service.spec.ts`](../../apps/api/src/modules/personalization/ritual.service.spec.ts):
  proves timezone segment selection, garments, persistence races, cache behavior, degradation, and complete scenario generation.
- [`apps/api/src/modules/personalization/ritual.controller.spec.ts`](../../apps/api/src/modules/personalization/ritual.controller.spec.ts):
  proves authentication, validated queries, persisted recommendations, and Redis-backed controller behavior.

Playwright API E2E test:

- [`playwright/tests/api/ritual-daily-outfits.spec.ts`](../../playwright/tests/api/ritual-daily-outfits.spec.ts):
  proves unauthenticated rejection, canonical three-scenario responses, and the optional location query over HTTP.

Pact contract tests:

- [`pact/http/consumer/mobile-api-client.pacttest.ts`](../../pact/http/consumer/mobile-api-client.pacttest.ts):
  proves the Mobile consumer expects the daily Ritual interaction from its generated client.
- [`pact/http/consumer/web-api-client.pacttest.ts`](../../pact/http/consumer/web-api-client.pacttest.ts):
  proves the Web consumer expects the same Ritual interaction.
- [`pact/http/provider/api-provider.pacttest.ts`](../../pact/http/provider/api-provider.pacttest.ts):
  replays the generated consumer Pacts against the provider controller boundary and its configured provider states.

Performance test:

- [`k6/tests/couture-api-baseline.k6test.ts`](../../k6/tests/couture-api-baseline.k6test.ts):
  exercises cold and cached Ritual reads, asserts three outfits with reasoning and weather data, and applies environment-adjusted latency thresholds.

Current repo note:

- `ritual.controller.ts` types `parsedQuery` as `RitualQueryParams` (imported from the shared Zod contract), which satisfies the `@typescript-eslint/no-unsafe-*` rules while `ritualQueryParamsSchema.parse(query)` still infers the shape at runtime.
- `GarmentItem` is imported from `@prisma/client` and typed as `GarmentItem | null` for `latestGarment` in the cache-freshness check, which removed the last `any` in the service.
- `outfitRecommendationCreateMock` in the controller spec uses an explicit intermediate type cast to read `.user.connect?.id` and `.forecast_segment?.connect?.id`, so the mock stays typed and lint-clean.
- Run `npm run build` at least once per session before `npm run lint`, so `eslint-plugin-import` can resolve the generated declaration files (e.g. `socket-events.d.ts`) in `packages/api-client/dist`.

Architecture diagram:

```mermaid
flowchart TD
  Client["GET /api/v1/ritual?locationId=..."] --> Controller["RitualController\n@UseGuards RequestAuthGuard"]
  Controller --> Service["RitualService\ngetOrCreateRitual(userId, locationId?)"]

  Service --> Redis{{"Redis\nritual:{userId}:{locationKey}"}}
  Redis -->|hit| Response["Cached RitualResponse"]
  Redis -->|miss| WeatherQ["WeatherQueryService\ngetLatestWeather(locationKey)"]

  WeatherQ --> Segments["Timezone-aware segment lookup\n8AM / 1PM / 7PM local"]
  Segments --> Comfort["ComfortPreferences\nruns_cold_warm ±3°C"]
  Comfort --> Garments["GarmentItem fetch\n(real closet or fallback placeholders)"]
  Garments --> Algo["Category matching\nOuterwear / Top+Bottom+Shoes / Dress+Shoes"]
  Algo --> Badges["Reasoning badges\n+ comfort notes"]
  Badges --> DB[("OutfitRecommendation\nDB upsert per segment+scenario")]
  DB --> Cache["Redis write\nTTL 900s"]
  Cache --> Response
```

## Step 20: Comfort calibration settings

User/business impact:

Users who run cold or warm can tune their comfort preferences, and the recommendation engine adjusts to them, which improves suggestion quality and customer satisfaction.

Key takeaways:

1. The shared Zod contract defines all preference enums (`runsColdWarm`, `windTolerance`, `precipPreparedness`) in `packages/api-client/src/contracts/http/comfort.ts`.
2. Cache invalidation walks Redis with a SCAN cursor and deletes keys in chunks, which keeps Redis threads responsive in a multi-tenant environment.
3. The recommendation engine tracks `ComfortPreferences.updated_at`, and a newer timestamp forces a database regeneration that overrides cached recommendations.

Story/Task mapping:

- Story 2.2
- Task 1 (Shared Zod HTTP Contract for Comfort Preferences)
- Task 2 (Comfort Preferences Controller and Service)
- Task 3 (Unit and Integration Test Verification)

Story reference:

- `_bmad-output/implementation-artifacts/2-2-comfort-calibration-settings.md`

Cross-links:

- Step 19 introduces the base daily outfit recommendation and caching.
- Step 21 maps these comfort parameters to reasoning explanation triggers.

Sequence to follow:

1. Open `packages/api-client/src/contracts/http/comfort.ts` for the preference schema enums and route registrations.
2. Read `apps/api/src/modules/personalization/comfort.service.ts` to see settings upserted or defaulted.
3. Read the `invalidateUserCache` method in `apps/api/src/modules/personalization/ritual.service.ts` to trace the Redis SCAN loop.
4. Read `apps/api/src/modules/personalization/comfort.controller.ts` for input validation and response parsing.
5. Review the tests in `apps/api/src/modules/personalization/comfort.service.spec.ts` and `comfort.controller.spec.ts`.

Task owner map:

- Story 2.2 Task 1 step 1 owner: define Zod schemas and request/response contracts for comfort preferences in `packages/api-client/src/contracts/http/comfort.ts`
- Story 2.2 Task 2 step 1 owner: implement ComfortService persistence and cache invalidation in `apps/api/src/modules/personalization/comfort.service.ts`
- Story 2.2 Task 2 step 2 owner: implement ComfortController route handlers in `apps/api/src/modules/personalization/comfort.controller.ts`
- Story 2.2 Task 2 step 3 owner: implement chunk-based Redis key invalidation in `apps/api/src/modules/personalization/ritual.service.ts`
- Story 2.2 Task 3 step 1 owner: unit-test default fallbacks, upserts, and cache invalidation in `apps/api/src/modules/personalization/comfort.service.spec.ts`
- Story 2.2 Task 3 step 2 owner: integration-test controller endpoints and validation boundaries in `apps/api/src/modules/personalization/comfort.controller.spec.ts`

Tests that cover this step:

API unit tests:

- [`apps/api/src/modules/personalization/comfort.service.spec.ts`](../../apps/api/src/modules/personalization/comfort.service.spec.ts):
  proves default preferences, stored value mapping, upsert, and Ritual cache invalidation.
- [`apps/api/src/modules/personalization/comfort.controller.spec.ts`](../../apps/api/src/modules/personalization/comfort.controller.spec.ts):
  proves authentication, request validation, defaults, existing values, updates, and cache invalidation delegation.
- [`apps/api/src/modules/personalization/ritual.service.spec.ts`](../../apps/api/src/modules/personalization/ritual.service.spec.ts):
  proves hot and cold calibration, wind tolerance, precipitation preparedness, and preference-driven cache invalidation.

Playwright API E2E test:

- [`playwright/tests/api/comfort-preferences.spec.ts`](../../playwright/tests/api/comfort-preferences.spec.ts):
  proves unauthenticated rejection and the comfort preference read and update lifecycle over HTTP.

Pact contract tests:

- [`pact/http/consumer/mobile-api-client.pacttest.ts`](../../pact/http/consumer/mobile-api-client.pacttest.ts):
  proves the Mobile consumer's comfort preference read and update interactions.
- [`pact/http/consumer/web-api-client.pacttest.ts`](../../pact/http/consumer/web-api-client.pacttest.ts):
  proves the Web consumer's matching interactions.
- [`pact/http/provider/api-provider.pacttest.ts`](../../pact/http/provider/api-provider.pacttest.ts):
  replays those generated Pacts against the provider controller boundary and configured provider states.

Performance test:

- [`k6/tests/couture-api-baseline.k6test.ts`](../../k6/tests/couture-api-baseline.k6test.ts):
  exercises default comfort reads and updated preference writes with environment-adjusted latency thresholds.

## Step 21: Reasoning badges and explanations

User/business impact:

Users see a localized explanation of why each outfit was suggested, which builds trust and keeps them coming back to the ritual.

Key takeaways:

1. Badge bullets are generated at runtime by filling actual conditions and the user's settings thresholds into the text.
2. Keep the type-safe test factories and seed data in sync with the badge shape to preserve database validation.
3. Pact checks the consumer's expected badge arrays against the provider's mocked states.

Story/Task mapping:

- Story 2.3
- Task 1 (Shared Zod Http Contract Update)
- Task 2 (API Personalization Module & Seed Updates)
- Task 3 (Pact Consumer & Provider Interaction Verification)
- Task 4 (Test Suite Validation & Verification)

Story reference:

- `_bmad-output/implementation-artifacts/2-3-reasoning-badges-explanations.md`

Cross-links:

- Step 19 introduces the outfit generator service.
- Step 20 sets up the user comfort calibration thresholds.

Sequence to follow:

1. Open `packages/api-client/src/contracts/http/ritual.ts` and look at the updated `reasoningBadges` property schema.
2. Read the badge rules in `apps/api/src/modules/personalization/ritual.service.ts` to see how bullet strings are built.
3. Read the mock factory in `packages/testing/src/factories/ritual.factory.ts` and the seed script in `packages/db/prisma/seeds/rituals.ts`.
4. Inspect the consumer and provider expectations in `pact/http/consumer/api-contract-interactions.ts` and `pact/http/provider/provider-helper.ts`.
5. Trace the unit assertions on bullet text in `apps/api/src/modules/personalization/ritual.service.spec.ts`.

Task owner map:

- Story 2.3 Task 1 step 1 owner: update reasoningBadges property in the HTTP contracts schema in `packages/api-client/src/contracts/http/ritual.ts`
- Story 2.3 Task 2 step 1 owner: refactor dynamic badge generation and interpolation in `apps/api/src/modules/personalization/ritual.service.ts`
- Story 2.3 Task 2 step 2 owner: update reasoning badges test factory schema in `packages/testing/src/factories/ritual.factory.ts`
- Story 2.3 Task 2 step 3 owner: update database seeding structures in `packages/db/prisma/seeds/rituals.ts`
- Story 2.3 Task 3 step 1 owner: update consumer contract pact expectations in `pact/http/consumer/api-contract-interactions.ts`
- Story 2.3 Task 3 step 2 owner: update provider mock responses in `pact/http/provider/provider-helper.ts`
- Story 2.3 Task 4 step 1 owner: test badge keys, labels, and bullet interpolation rules in `apps/api/src/modules/personalization/ritual.service.spec.ts`

Tests that cover this step:

Shared contract and fixture unit tests:

- [`packages/api-client/testing/ritual-contract.spec.ts`](../../packages/api-client/testing/ritual-contract.spec.ts):
  proves each reasoning badge has at least one bullet and rejects malformed scenario collections.
- [`packages/testing/test/ritual.factory.spec.ts`](../../packages/testing/test/ritual.factory.spec.ts):
  proves fixture badges match the UI-facing key, label, and bullet shape.

API unit test:

- [`apps/api/src/modules/personalization/ritual.service.spec.ts`](../../apps/api/src/modules/personalization/ritual.service.spec.ts):
  proves badge mapping, dynamic labels, interpolation, fallback keys, and integer-safe wind and precipitation copy.

Mobile component test:

- [`apps/mobile/src/screens/hero-experience.test.tsx`](../../apps/mobile/src/screens/hero-experience.test.tsx):
  proves the recommendation card renders a reasoning badge in the loaded hero state.

Playwright API E2E test:

- [`playwright/tests/api/ritual-daily-outfits.spec.ts`](../../playwright/tests/api/ritual-daily-outfits.spec.ts):
  proves every returned outfit carries structured badge keys, labels, and non-empty bullet arrays over HTTP.

Pact contract tests:

- [`pact/http/consumer/mobile-api-client.pacttest.ts`](../../pact/http/consumer/mobile-api-client.pacttest.ts):
  pins Ritual response badge keys, labels, and bullets in Mobile consumer expectations.
- [`pact/http/consumer/web-api-client.pacttest.ts`](../../pact/http/consumer/web-api-client.pacttest.ts):
  pins Ritual response badge keys, labels, and bullets in Web consumer expectations.
- [`pact/http/provider/api-provider.pacttest.ts`](../../pact/http/provider/api-provider.pacttest.ts):
  replays those expectations against the provider controller boundary and configured Ritual state.

Performance test:

- [`k6/tests/couture-api-baseline.k6test.ts`](../../k6/tests/couture-api-baseline.k6test.ts):
  asserts a generated Ritual has at least one reasoning badge while exercising the environment-adjusted Ritual latency threshold.

## Step 22: Localization infrastructure and quality gates

User/business impact:

CoutureCast can ship in Turkish, German, Italian, and Portuguese with localized copy, currency, and measurement units.
Automated checks catch broken layouts, missing dictionary entries, and translation drift before release.

Key takeaways:

1. Frontend i18n config maps locales and fallback rules, and formatter libraries handle currency and temperature per locale.
2. Unit tests check key parity and placeholder variables (`{feelsLike}`) across every supported language.
3. Headless browser tests assert that scroll width matches the view width, which catches text overflow and broken layouts on PR checks.
4. Pact consumer and provider tests check that the `Accept-Language` header reaches NestJS from Expo.

Story/Task mapping:

- Story 3.2
- Task 1 (Client i18n framework & Translation Catalogs)
- Task 2 (Dynamic unit, currency formatting, and layout assertions)
- Task 3 (Backend API interceptors, dictionaries, and contract checks)
- Task 4 (Quality gates, unit validations, and verification checklists)

Story reference:

- `_bmad-output/implementation-artifacts/3-2-localization-infrastructure.md`

Cross-links:

- Step 19 introduces the outfit recommendations service.
- Step 20 defines comfort preferences settings.

Sequence to follow:

1. Review translation key registration in `apps/mobile/src/lib/i18n.ts` and the language assets.
2. Inspect the unit formatter logic and its tests in `apps/mobile/src/lib/formatters.ts` and `apps/mobile/src/lib/formatters.test.ts`.
3. Look at the translation parity and placeholder tests in `apps/api/src/modules/personalization/ritual.service.spec.ts`.
4. Inspect the headless browser layout test in `apps/mobile/src/screens/tab-two-screen.test.tsx`, which checks scroll boundaries in every locale.
5. Check the consumer and provider Pact rules in `pact/http/consumer/api-contract-interactions.ts` and `pact/http/provider/provider-helper.ts`.

Task owner map:

- Step 22 step 1 owner: define language resources and system defaults in `apps/mobile/src/lib/i18n.ts`
- Step 22 step 2 owner: implement locale-aware currency and temperature formatting in `apps/mobile/src/lib/formatters.ts`
- Step 22 step 3 owner: define localized comfort notes and intercept headers in `apps/api/src/modules/personalization/ritual.service.ts`
- Step 22 step 4 owner: verify translation key parity and placeholder replacements in `apps/api/src/modules/personalization/ritual.service.spec.ts`
- Step 22 step 5 owner: check Accept-Language header propagation in Pact consumer tests in `pact/http/consumer/api-contract-interactions.ts`
- Step 22 step 6 owner: mock localized database state response in Pact provider tests in `pact/http/provider/provider-helper.ts`
- Step 22 step 7 owner: verify Settings screen layout boundaries in headless Chromium in `apps/mobile/src/screens/tab-two-screen.test.tsx`

Tests that cover this step:

Shared and API unit tests:

- [`packages/api-client/testing/localization-contract.spec.ts`](../../packages/api-client/testing/localization-contract.spec.ts):
  proves supported locale values, normalization, weighted `Accept-Language` negotiation, and explicit Ritual locale overrides.
- [`apps/api/src/modules/personalization/ritual.service.spec.ts`](../../apps/api/src/modules/personalization/ritual.service.spec.ts):
  proves locale precedence, localized notes and badges, cache isolation, translation-key parity, and placeholder parity.
- [`apps/api/src/modules/personalization/ritual.controller.spec.ts`](../../apps/api/src/modules/personalization/ritual.controller.spec.ts):
  proves explicit locale handling, localized cache isolation, and unsupported-locale rejection.
- [`apps/api/src/modules/user/user.controller.spec.ts`](../../apps/api/src/modules/user/user.controller.spec.ts):
  proves valid locale updates and unsupported locale rejection.
- [`apps/api/src/modules/user/user.service.spec.ts`](../../apps/api/src/modules/user/user.service.spec.ts):
  proves locale merging preserves unrelated profile preferences.

Mobile client and component tests:

- [`apps/mobile/src/lib/formatters.test.ts`](../../apps/mobile/src/lib/formatters.test.ts):
  proves locale-aware temperature, currency, and measurement formatting plus a safe formatter fallback.
- [`apps/mobile/src/lib/i18n.test.ts`](../../apps/mobile/src/lib/i18n.test.ts):
  proves ranked device-locale resolution, first-launch adoption, translation loading, persisted selection, and initialization memoization.
- [`apps/mobile/src/lib/i18n-init-fallback.test.ts`](../../apps/mobile/src/lib/i18n-init-fallback.test.ts):
  proves initialization can retry after total failure and recover in English when a device locale bundle fails.
- [`apps/mobile/src/screens/localization.test.tsx`](../../apps/mobile/src/screens/localization.test.tsx):
  proves runtime language switching, English fallback, regional device locale selection, and absence of a stored override.
- [`apps/mobile/src/screens/tab-two-screen.test.tsx`](../../apps/mobile/src/screens/tab-two-screen.test.tsx):
  proves locale persistence, sync retries, local fallback, analytics, and layout without truncation across supported locales.

Pact contract tests:

- [`pact/http/consumer/mobile-api-client.pacttest.ts`](../../pact/http/consumer/mobile-api-client.pacttest.ts):
  proves explicit localized Ritual and locale preference interactions from the Mobile consumer.
- [`pact/http/provider/api-provider.pacttest.ts`](../../pact/http/provider/api-provider.pacttest.ts):
  replays the localized consumer Pacts against the provider controller boundary and configured states.

Mobile E2E test:

- [`maestro/localization.yaml`](../../maestro/localization.yaml):
  exercises language selection and localized visible copy in the built Mobile application.

## Step 23: Home and lock-screen widgets

User/business impact:

Home and lock-screen widgets show premium outfit recommendations and current weather without opening the app.
A widget tap deep links into the localized plan, which drives engagement and retention.

Key takeaways:

1. Native widget code in Kotlin and Swift only presents data.
   The JavaScript/TypeScript layer makes the API calls, formats the state, and syncs it to the widget.
2. A custom bridge (`WidgetSharedModule`) persists weather and outfit state to SharedPreferences on Android and App Group UserDefaults on iOS.
3. A lightweight `expo-background-fetch` task keeps widget state fresh while the app is suspended, within the system's battery limits.
4. A widget tap hydrates the active scenario and fires a telemetry capture.

Story/Task mapping:

- Story 3.3
- Task 1 (Shared Widget Data Utility)
- Task 2 (Native Widget Implementations)
- Task 3 (Background Sync Task)
- Task 4 (App Deep-Link Hydration & Telemetry)
- Task 5 (Vitest & Maestro Verification)

Story reference:

- `_bmad-output/implementation-artifacts/3-3-home-lock-screen-widgets.md`

Cross-links:

- Step 22 sets up the localization dictionaries and currency/temperature formatters.
- Step 8 defines shared analytics tracking contracts.

Sequence to follow:

1. Inspect the serialization schema and time-of-day scenario mapping in `apps/mobile/src/lib/widget-share.ts`.
2. Trace the widget-sharing hook inside `saveRitualCache` in `apps/mobile/src/lib/ritual-cache.ts`.
3. Check the custom bridge package and widget providers under `apps/mobile/android/app/src/main/java/com/anonymous/mobile/`.
4. Review the SwiftUI widget views and the iOS App Group entitlements config in `apps/mobile/targets/widgets/OutfitWidget.swift` and `apps/mobile/plugins/with-widgets.js`.
5. Trace the background fetch registration on app start in `apps/mobile/app/_layout.tsx` and the task logic in `apps/mobile/src/lib/background-fetch.ts`.
6. Inspect the parameter parsing and PostHog capture triggers in `apps/mobile/app/(tabs)/index.tsx`.
7. Check the deep-link routing assertions in `apps/mobile/src/screens/widget-deep-link.test.tsx` and the E2E flows in `maestro/widget-deep-link.yaml`.

Task owner map:

- Story 3.3 Task 1 step 1 owner: implement the shareWidgetData serialization utility in `apps/mobile/src/lib/widget-share.ts`
- Story 3.3 Task 1 step 2 owner: call the widget share utility inside saveRitualCache in `apps/mobile/src/lib/ritual-cache.ts`
- Story 3.3 Task 2 step 1 owner: implement base OutfitWidgetProvider update and deep-link launcher logic in `apps/mobile/android/app/src/main/java/com/anonymous/mobile/OutfitWidgetProvider.kt`
- Story 3.3 Task 2 step 2 owner: configure iOS App Group entitlements and Swift bridge files copy during prebuilds in `apps/mobile/plugins/with-widgets.js`
- Story 3.3 Task 2 step 3 owner: define SwiftUI small and medium layouts in `apps/mobile/targets/widgets/OutfitWidget.swift`
- Story 3.3 Task 3 step 1 owner: define background fetch task using task manager in `apps/mobile/src/lib/background-fetch.ts`
- Story 3.3 Task 4 step 1 owner: read deep link query parameters to hydrate active scenario in `apps/mobile/app/(tabs)/index.tsx`
- Story 3.3 Task 5 step 1 owner: verify widget deep link hydration and telemetry triggers in screen tests in `apps/mobile/src/screens/widget-deep-link.test.tsx`
- Story 3.3 Task 5 step 2 owner: define E2E Maestro routing verification scenarios in `maestro/widget-deep-link.yaml`

Tests that cover this step:

Native generation integration test:

- [`apps/mobile/plugins/with-widgets.test.js`](../../apps/mobile/plugins/with-widgets.test.js):
  proves a clean Expo prebuild generates iOS and Android widget targets, bridges, entitlements, fonts, native registrations, and localized fallback copy.

Mobile client unit and component tests:

- [`apps/mobile/src/lib/background-fetch.test.ts`](../../apps/mobile/src/lib/background-fetch.test.ts):
  proves freshness boundaries, task registration, refresh and publication, locale reuse, degraded preferences, and failure preservation.
- [`apps/mobile/src/lib/native-file-storage.test.ts`](../../apps/mobile/src/lib/native-file-storage.test.ts):
  proves durable Ritual and settings storage plus cache preservation when widget publication fails.
- [`apps/mobile/src/lib/widget-share.test.ts`](../../apps/mobile/src/lib/widget-share.test.ts):
  proves localized payload serialization, next-hour selection, severe-alert filtering, preference failure behavior, and timezone fallback.
- [`apps/mobile/src/screens/widget-deep-link.test.tsx`](../../apps/mobile/src/screens/widget-deep-link.test.tsx):
  proves current and next widget hydration, telemetry, repeated links, and rejection of malformed parameters.

Mobile E2E test:

- [`maestro/widget-deep-link.yaml`](../../maestro/widget-deep-link.yaml):
  opens the current and next widget links and verifies the scenario surface remains available after each route.

## Step 24: watchOS glance companion app and complications

User/business impact:

The watch shows current feels-like conditions and the outfit at a glance, without taking out the phone.
Watch faces and complications put CoutureCast in front of users more often each day.

Key takeaways:

1. The watchOS target gets all its data through `WatchConnectivity` transfers from the iOS app, which saves watch battery and makes it load instantly.
2. WatchConnectivity carries messages in both directions.
   The iOS app sends cached payload dictionaries with `updateApplicationContext` for state sync and `transferCurrentComplicationUserInfo` for high-priority complication updates.
3. Complications read the serialized payload from a watch-scoped App Group container (`group.com.anonymous.mobile.watch`) and support the circular, modular, and rectangular families.
4. Severe weather alerts play a wrist haptic (`WKInterfaceDevice.current().play(.notification)`) only after passing the user's quiet-hours check.

Story/Task mapping:

- Story 3.4
- Task 1 (iOS-side WatchConnectivity Integration)
- Task 2 (watchOS Companion App SwiftUI)
- Task 3 (watchOS Complications & WidgetKit)
- Task 4 (Expo Config Plugin for watchOS)
- Task 5 (Verification & Documentation)

Story reference:

- `_bmad-output/implementation-artifacts/3-4-watchos-glance.md`

Cross-links:

- Step 23 introduces the shared widget serialization payload and iOS App Group bridge.
- Step 25 extends responsive surface coverage across desktop, tablet, and mobile.

Sequence to follow:

1. Read `apps/mobile/plugins/with-watchos.js` to see how the Expo config plugin sets up the watchOS Xcode targets and App Group entitlements.
2. Inspect `apps/mobile/targets/widgets/WidgetSharedModule.swift` to trace `WCSessionDelegate` activation and `WatchConnectivity` transfers.
3. Open `apps/mobile/targets/watchos/WatchConnectivityManager.swift` for payload reception, App Group persistence, and timeline reloads on watchOS.
4. Read `apps/mobile/targets/watchos/WatchContentView.swift` for the SwiftUI layout that shows current and next-hour outfit cues with haptic alerts.
5. Inspect `apps/mobile/targets/watchos/WatchComplication.swift` to trace the circular, modular, and rectangular complication timeline providers.

Task owner map:

- Story 3.4 Task 1 step 1 owner: activate WatchConnectivity session and transfer payloads in `apps/mobile/targets/widgets/WidgetSharedModule.swift`
- Story 3.4 Task 2 step 1 owner: handle watch-side WCSession delegate callbacks and App Group storage in `apps/mobile/targets/watchos/WatchConnectivityManager.swift`
- Story 3.4 Task 2 step 2 owner: render watchOS SwiftUI glance and next-hour forecast views in `apps/mobile/targets/watchos/WatchContentView.swift`
- Story 3.4 Task 3 step 1 owner: provide WidgetKit watch complications reading from watch App Group in `apps/mobile/targets/watchos/WatchComplication.swift`
- Story 3.4 Task 4 step 1 owner: generate watchOS targets and link font resources in Expo config plugin in `apps/mobile/plugins/with-watchos.js`

Tests that cover this step:

Native generation and Swift integration test:

- [`apps/mobile/plugins/with-watchos.test.js`](../../apps/mobile/plugins/with-watchos.test.js):
  proves repeatable Expo prebuild generation, target embedding, entitlements, sources, fonts, WatchConnectivity linking, payload decoding, and native Swift behavior tests.

Mobile payload and component tests:

- [`apps/mobile/src/lib/widget-share.test.ts`](../../apps/mobile/src/lib/widget-share.test.ts):
  proves the localized current and next forecast payload that the phone makes available to glance surfaces.
- [`apps/mobile/src/lib/widget-alert-preferences.test.ts`](../../apps/mobile/src/lib/widget-alert-preferences.test.ts):
  proves canonical preference parsing and fail-closed behavior when preferences are unavailable or invalid.
- [`apps/mobile/src/screens/widget-deep-link.test.tsx`](../../apps/mobile/src/screens/widget-deep-link.test.tsx):
  proves a watch handoff hydrates the next outfit and records a `watch_tap` interaction without widget dimensions.

The repository has no automated physical watch or simulator E2E file.
The listed suites cover generated native projects, native Swift test entrypoints, payload preparation, and phone-side handoff behavior.

Architecture diagram:

```mermaid
flowchart TD
  iOSApp[iOS App / WidgetSharedModule] -->|WCSession updateApplicationContext| WCSession[WatchConnectivity Session]
  WCSession -->|transferCurrentComplicationUserInfo| WatchManager[WatchConnectivityManager.swift]
  WatchManager -->|persists JSON payload| WatchGroup[App Group: group.com.anonymous.mobile.watch]
  WatchGroup --> WatchView[WatchContentView.swift\nSwiftUI Glance & Forecast]
  WatchGroup --> WatchWidget[WatchComplication.swift\nWidgetKit Complications]
```

## Step 25: Lookbook Prism responsive layout and community grid

User/business impact:

The hero ritual and the community lookbook adapt to desktop, tablet, mobile, and ultrawide screens.
Fluid split layouts let users compare two outfits side by side and preview the mobile layout from a desktop.
The business goal is cross-device retention, content discovery, and engagement.

Key takeaways:

1. Lookbook Prism orchestrator: one non-blocking responsive grid holds the hero outfit ritual and the community lookbook feed (`grid grid-cols-1 md:grid-cols-2 lg:grid-cols-2 xl:grid-cols-[1fr_1fr_320px]`).
2. Design tokens: CoutureCast Surface tokens (`#FFFFFF` background, `#F5F5F7` elevated surface, `#111111` Onyx text, `#C9A14A` Gold accent, `#E6E6ED` Cloud rules), 8px corner radii, and 2dp elevation.
3. Comparison and preview controls: Comparison Mode shows two outfits side by side, and Mobile Preview shrinks the desktop layout to a simulated 375px container.
4. Accessibility and motion: gold (`#C9A14A`) focus rings, `aria-live="polite"` announcements when filters change, and `prefers-reduced-motion` detection target WCAG 2.1 AA.

Story/Task mapping:

- Story 3.5
- Task 1 (Shared Layout Engine & Breakpoint Strategy)
- Task 2 (Responsive Community Lookbook Component)
- Task 3 (Interactive Comparison Mode & Mobile Viewport Toggle)
- Task 4 (Performance, Motion, & Accessibility Hardening)
- Task 5 (Cross-Surface Synchronization & Telemetry)
- Task 6 (Vitest & Quality Gate Test Automation)

Story reference:

- `_bmad-output/implementation-artifacts/3-5-lookbook-prism-responsive-layout.md`

Cross-links:

- Step 23 provides home and lock-screen widget deep links into hero ritual contexts.
- Step 24 provides glanceable outfit cues on the watch.

Sequence to follow:

1. Read `apps/web/src/app/components/lookbook-prism-layout.tsx` for the multi-breakpoint grid, reduced-motion handling, and telemetry.
2. Inspect `apps/web/src/app/components/community-lookbook-grid.tsx` for the filter tabs (`New`, `Following`, `Near me`, `Brands`), ARIA status regions, and card grids.
3. Read `apps/web/src/app/components/layout-controls.tsx` for the Comparison Mode and Mobile Preview toggles and their PostHog events.
4. Inspect `apps/web/src/app/components/planner-rail.tsx` for the 7-day outfit planning drawer on ultrawide screens (1440px and wider).
5. Review test suites in `apps/web/src/app/components/layout-controls.test.tsx`, `community-lookbook-grid.test.tsx`, `lookbook-prism-layout.test.tsx`, and `playwright/tests/lookbook-prism.spec.ts`.

Task owner map:

- Story 3.5 Task 1 step 1 owner: orchestrate responsive grid breakpoints and hero/community panels in `apps/web/src/app/components/lookbook-prism-layout.tsx`
- Story 3.5 Task 1 step 2 owner: implement ultrawide 7-day planning drawer in `apps/web/src/app/components/planner-rail.tsx`
- Story 3.5 Task 2 step 1 owner: implement community lookbook filter chips, card grid, and ARIA live regions in `apps/web/src/app/components/community-lookbook-grid.tsx`
- Story 3.5 Task 3 step 1 owner: implement comparison mode and mobile preview toggle controls with telemetry in `apps/web/src/app/components/layout-controls.tsx`
- Story 3.5 Task 6 step 1 owner: unit-test layout controls and PostHog event triggers in `apps/web/src/app/components/layout-controls.test.tsx`
- Story 3.5 Task 6 step 2 owner: unit-test community lookbook filter chip interactions and ARIA status in `apps/web/src/app/components/community-lookbook-grid.test.tsx`
- Story 3.5 Task 6 step 3 owner: integration-test Lookbook Prism responsive layout, comparison mode, and focus rings in `apps/web/src/app/components/lookbook-prism-layout.test.tsx`
- Story 3.5 Task 6 step 4 owner: E2E smoke test responsive layout boundaries across viewports in `playwright/tests/lookbook-prism.spec.ts`

Tests that cover this step:

Web unit and component tests:

- [`apps/web/src/app/components/layout-controls.test.tsx`](../../apps/web/src/app/components/layout-controls.test.tsx):
  proves the comparison and mobile-preview toggles, ARIA state, callbacks, and `layout_interaction` telemetry.
- [`apps/web/src/app/components/community-lookbook-grid.test.tsx`](../../apps/web/src/app/components/community-lookbook-grid.test.tsx):
  proves filter state, polite announcements, click updates, and keyboard-safe image-failure cards.
- [`apps/web/src/app/components/lookbook-prism-layout.test.tsx`](../../apps/web/src/app/components/lookbook-prism-layout.test.tsx):
  proves responsive regions, comparison cards, mobile preview, planner restoration, reduced motion, semantic order, and chip synchronization.

Playwright end-to-end test:

- [`playwright/tests/lookbook-prism.spec.ts`](../../playwright/tests/lookbook-prism.spec.ts):
  proves the layout and its controls render across desktop and mobile viewport boundaries.

Architecture diagram:

```mermaid
flowchart TD
  Page["apps/web/src/app/page.tsx"] --> Layout["LookbookPrismLayout"]
  Layout --> Controls["LayoutControls\nComparison Mode & Mobile Preview Toggles"]
  Layout --> HeroSlot["Hero Ritual Canvas\n(Primary Recommended Look / Dual Comparison Cards)"]
  Layout --> CommunitySlot["CommunityLookbookGrid\n(Filter Chips + Responsive Lookbook Cards)"]
  Layout --> PlannerSlot["PlannerRail\n(Ultrawide ≥1440px Container)"]
```

## Step 26: Chip navigation and sticky bottom nav

User/business impact:

Category filters and the mobile bottom nav stay reachable while users scroll, swipe, or browse by keyboard.
Touch snap points, sticky positioning, and safe-area insets keep them in place, and analytics events record each switch.
The business goal is more view engagement, faster content pivots, and retention on mobile and web.

Key takeaways:

1. Category chips: a sticky chip bar shows `Personal`, `Community`, and `Sponsored` filters with CSS scroll-snap (`snap-x snap-mandatory`).
2. Keyboard and screen reader: arrow navigation (`ArrowLeft`, `ArrowRight`, `Home`, `End`), `aria-pressed` states, visible gold focus rings (`focus-visible:outline-[#C9A14A]`), and announcements through a hidden `aria-live="polite"` region.
3. Mobile sticky bottom nav: a fixed bar (`fixed bottom-0 left-0 right-0 z-30`) shows on mobile viewports (`<768px`) and in mobile preview, with a solid gold active underline (`#C9A14A`) and safe-area bottom padding (`pb-[env(safe-area-inset-bottom,0.75rem)]`).
4. Telemetry isolation: the `chip_changed` and `bottom_nav_clicked` PostHog events sit inside exception guards, so rendering keeps working when analytics is down.

Story/Task mapping:

- Story 3.6
- Task 1 (Web Chip Navigation Component)
- Task 2 (Web Mobile Sticky Bottom Navigation Component)
- Task 3 (Mobile Expo Bottom Tab Bar & Chip Component)
- Task 4 (State Sync & Feed Module Filtering)
- Task 5 (Vitest Unit & Integration Test Automation)
- Task 6 (E2E Playwright & Maestro Test Verification)

Story reference:

- `_bmad-output/implementation-artifacts/3-6-chip-navigation-sticky-bottom-nav.md`

Cross-links:

- Step 25 provides the Lookbook Prism grid and community lookbook feeds that the chip filters switch.
- Step 21 provides the mobile hero landing screen and scenario recommendation cards.

Sequence to follow:

1. Read `apps/web/src/app/components/chip-navigation.tsx` for the sticky container, scroll-snap layout, arrow-key listeners, and PostHog events.
2. Inspect `apps/web/src/app/components/sticky-bottom-nav.tsx` for fixed mobile positioning, the gold active underline, and safe-area insets.
3. Inspect `apps/mobile/components/chip-navigation.tsx` and `apps/mobile/app/(tabs)/_layout.tsx` for the React Native ScrollView chips and the Expo gold active tint.
4. Read `apps/web/src/app/components/lookbook-prism-layout.tsx` to see how chip selection syncs the hero recommendations and community lookbook feeds.
5. Review test suites in `apps/web/src/app/components/chip-navigation.test.tsx`, `sticky-bottom-nav.test.tsx`, `apps/mobile/components/chip-navigation.test.tsx`, and `playwright/tests/chip-navigation-bottom-nav.spec.ts`.

Task owner map:

- Story 3.6 Task 1 step 1 owner: implement sticky chip navigation with keyboard arrow traversal and telemetry in `apps/web/src/app/components/chip-navigation.tsx`
- Story 3.6 Task 2 step 1 owner: implement mobile sticky bottom navigation bar with gold active indicator and safe-area insets in `apps/web/src/app/components/sticky-bottom-nav.tsx`
- Story 3.6 Task 3 step 1 owner: implement mobile React Native chip navigation component with touch snap scrolling in `apps/mobile/components/chip-navigation.tsx`
- Story 3.6 Task 5 step 1 owner: unit-test web chip navigation keyboard traversal, ARIA live updates, and telemetry error isolation in `apps/web/src/app/components/chip-navigation.test.tsx`
- Story 3.6 Task 5 step 2 owner: unit-test web sticky bottom navigation mobile visibility and telemetry in `apps/web/src/app/components/sticky-bottom-nav.test.tsx`
- Story 3.6 Task 5 step 3 owner: unit-test mobile React Native chip navigation pressables and selection state in `apps/mobile/components/chip-navigation.test.tsx`
- Story 3.6 Task 6 step 1 owner: E2E test sticky bottom nav viewport visibility, chip keyboard navigation, and reduced motion in `playwright/tests/chip-navigation-bottom-nav.spec.ts`

Tests that cover this step:

Web unit and component tests:

- [`apps/web/src/app/components/chip-navigation.test.tsx`](../../apps/web/src/app/components/chip-navigation.test.tsx):
  proves chip semantics, arrow-key focus movement, clean Tab exit, announcements, telemetry, and analytics failure isolation.
- [`apps/web/src/app/components/sticky-bottom-nav.test.tsx`](../../apps/web/src/app/components/sticky-bottom-nav.test.tsx):
  proves four-tab rendering, route-derived active state, the gold indicator, responsive visibility classes, and click telemetry.
- [`apps/web/src/app/components/lookbook-prism-layout.test.tsx`](../../apps/web/src/app/components/lookbook-prism-layout.test.tsx):
  proves chip selection stays in sync with the visible hero and community content.

Mobile component tests:

- [`apps/mobile/components/chip-navigation.test.tsx`](../../apps/mobile/components/chip-navigation.test.tsx):
  proves the native chips render and report the selected value on press.
- [`apps/mobile/src/screens/hero-experience.test.tsx`](../../apps/mobile/src/screens/hero-experience.test.tsx):
  proves mobile chip selection changes the displayed recommendation.

Playwright end-to-end test:

- [`playwright/tests/chip-navigation-bottom-nav.spec.ts`](../../playwright/tests/chip-navigation-bottom-nav.spec.ts):
  proves viewport visibility, sticky chip state, keyboard focus movement, focus appearance, and reduced-motion behavior.

Mobile end-to-end test:

- [`maestro/chip-navigation-bottom-nav.yaml`](../../maestro/chip-navigation-bottom-nav.yaml):
  exercises native chip selection and bottom-tab navigation to the Community screen.

Architecture diagram:

```mermaid
flowchart TD
  Page["apps/web/src/app/page.tsx"] --> PrismLayout["LookbookPrismLayout"]
  PrismLayout --> StickyChips["ChipNavigation\n(Personal / Community / Sponsored)"]
  PrismLayout --> BottomNav["StickyBottomNav\n(Mobile Viewport / Preview Fixed Anchor)"]
  StickyChips --> FeedSync["Recommendation & Community Feed Sync"]
  StickyChips --> PostHog["PostHog chip_changed"]
  BottomNav --> PostHogNav["PostHog bottom_nav_clicked"]
```

## Step 27: Widget and notification deep-link handling

User/business impact:

Opening Couture Cast from a home-screen widget, watch glance, severe weather alert, or community ping lands the user where they meant to go.
Web and mobile load the matching hero recommendation, focus the weather alert banner, or highlight the target community card, with no blank or error screen.
The business goal is re-engagement, feature discovery, and retention.

Key takeaways:

1. Shared deep-link kernel: `packages/utils/src/deep-link.ts` exports Zod schemas (`deepLinkSchema`), a parser (`parseDeepLink`), and a scenario resolver (`resolveDeepLinkScenario`) for widget slots (`am`, `pm`, `evening`, `now`, `next`) and notification types (`severe_weather`, `community`).
2. Web hydration and focus: `apps/web/src/app/lib/deep-link-handler.ts` parses query parameters on launch, loads hero recommendation cards, scrolls to and focuses severe weather alerts, and highlights the target community lookbook card.
3. Mobile Expo Router handling: `apps/mobile/src/lib/mobile-deep-link-handler.ts` reads Expo Router search parameters, clears them with `router.setParams()`, focuses `WeatherAlertBanner`, and routes to `community.tsx` with the card highlighted.
4. Fallbacks: an invalid or expired payload falls back to the default hero ritual view, renders an accessible `<InfoBanner>` ("We refreshed your data after reconnecting"), and fires PostHog `deep_link_invalid`.
5. Telemetry and announcements: a valid link fires the `deep_link_handled` PostHog event, and ARIA live regions (`aria-live="polite"`, `role="status"`) announce the change.

Story/Task mapping:

- Story 3.7
- Task 1 (Shared Deep-Link Parsing & Validation Utility)
- Task 2 (Web Deep-Link Hydration, Alert Focus & Community Card Highlighting)
- Task 3 (Mobile Expo Router Deep-Link Hydration & Focus Management)
- Task 4 (Invalid & Expired Info Banner Component)
- Task 5 (Vitest & Component Unit Tests)
- Task 6 (E2E Playwright & Maestro Automation)

Story reference:

- `_bmad-output/implementation-artifacts/3-7-widget-notification-deep-link-handling.md`

Cross-links:

- Step 23 provides home and lock-screen widget configuration (`source=widget&size=small|medium&slot=now|next`).
- Step 26 provides the sticky chips (`Personal`, `Community`, `Sponsored`) that stay in sync with deep-link scenario hydration.

Sequence to follow:

1. Read `packages/utils/src/deep-link.ts` for the Zod schemas, source/slot/type validation, parameter array normalization, expiry checks, and scenario resolution.
2. Inspect `apps/web/src/app/lib/deep-link-handler.ts` and `apps/web/src/app/components/lookbook-prism-layout.tsx` for web search parameter parsing, alert autoscroll, and community card highlight borders.
3. Inspect `apps/mobile/src/lib/mobile-deep-link-handler.ts`, `apps/mobile/app/(tabs)/index.tsx`, and `apps/mobile/app/(tabs)/community.tsx` for Expo Router deep-link processing and route handoffs.
4. Read `apps/web/src/app/components/info-banner.tsx` and `apps/mobile/components/info-banner.tsx` for the invalid deep-link banner on both platforms.
5. Review test suites in `packages/utils/src/deep-link.spec.ts`, `apps/web/src/app/components/deep-link-handling.test.tsx`, `apps/mobile/src/screens/deep-link-handling.test.tsx`, `apps/mobile/src/lib/mobile-deep-link-handler.test.ts`, and `playwright/tests/deep-link-handling.spec.ts`.

Task owner map:

- Story 3.7 Task 1 step 1 owner: implement shared Zod deep-link parser, slot mapping, and expiry validation in `packages/utils/src/deep-link.ts`
- Story 3.7 Task 2 step 1 owner: implement web deep-link handler, alert autoscroll, and community card highlight in `apps/web/src/app/lib/deep-link-handler.ts`
- Story 3.7 Task 3 step 1 owner: implement mobile deep-link handler and Expo Router parameter processing in `apps/mobile/src/lib/mobile-deep-link-handler.ts`
- Story 3.7 Task 4 step 1 owner: implement web reusable info banner for invalid deep link notifications in `apps/web/src/app/components/info-banner.tsx`
- Story 3.7 Task 4 step 2 owner: implement mobile reusable info banner for invalid deep link notifications in `apps/mobile/components/info-banner.tsx`
- Story 3.7 Task 5 step 1 owner: unit-test web deep-link hydration, severe weather focus, and invalid banner in `apps/web/src/app/components/deep-link-handling.test.tsx`
- Story 3.7 Task 5 step 2 owner: unit-test mobile deep-link hydration, severe weather alert focus, and community card highlight in `apps/mobile/src/screens/deep-link-handling.test.tsx`
- Story 3.7 Task 5 step 3 owner: unit-test mobile deep-link handler orchestration logic across all branches in `apps/mobile/src/lib/mobile-deep-link-handler.test.ts`
- Story 3.7 Task 6 step 1 owner: E2E Playwright test widget tap, severe weather alert focus, community lookbook highlight, and invalid deep link fallback in `playwright/tests/deep-link-handling.spec.ts`

Tests that cover this step:

Shared parser and target-resolution unit tests:

- [`packages/utils/src/deep-link.spec.ts`](../../packages/utils/src/deep-link.spec.ts): proves parameter normalization, widget and notification validation, expiry handling, scenario resolution, and deep-link intent detection.
- [`packages/api-client/testing/deep-link-targets.spec.ts`](../../packages/api-client/testing/deep-link-targets.spec.ts): proves newest and requested target selection, missing targets, channel exclusion, malformed socket payload handling, and duplicate-event recency.

Web component test:

- [`apps/web/src/app/components/deep-link-handling.test.tsx`](../../apps/web/src/app/components/deep-link-handling.test.tsx): proves widget hydration, severe-alert focus, community targeting, invalid-link telemetry, and degraded fallbacks.

Mobile unit and screen tests:

- [`apps/mobile/src/lib/mobile-deep-link-handler.test.ts`](../../apps/mobile/src/lib/mobile-deep-link-handler.test.ts): proves every orchestration branch for widget, watch, severe-weather, community, invalid, missing, and failed target resolution.
- [`apps/mobile/src/screens/deep-link-handling.test.tsx`](../../apps/mobile/src/screens/deep-link-handling.test.tsx): proves visible focus, highlight, banner, and fallback states for notification links.
- [`apps/mobile/src/screens/widget-deep-link.test.tsx`](../../apps/mobile/src/screens/widget-deep-link.test.tsx): proves `now`, `next`, watch, later-link, and invalid widget hydration while the Home tab stays mounted.

Playwright end-to-end test:

- [`playwright/tests/deep-link-handling.spec.ts`](../../playwright/tests/deep-link-handling.spec.ts): proves widget hero hydration, severe-alert focus, community highlighting, and invalid-link fallback in the browser.

Mobile end-to-end test:

- [`maestro/deep-link-handling.yaml`](../../maestro/deep-link-handling.yaml): exercises severe-weather notification focus and the invalid-link information banner in a built app.
- [`maestro/widget-deep-link.yaml`](../../maestro/widget-deep-link.yaml): opens native `now` and `next` widget links and checks that the scenario surface stays visible.

Architecture diagram:

```mermaid
flowchart TD
  URL["Deep Link URL\n(?source=widget|notification&slot=...|type=...)"] --> Parser["parseDeepLink\n(packages/utils/src/deep-link.ts)"]
  Parser -->|Valid Widget| Hydrate["Hydrate Hero Canvas\n& Active Category Chip"]
  Parser -->|Valid Weather Alert| FocusAlert["Focus WeatherAlertBanner\n& Autoscroll into View"]
  Parser -->|Valid Community Ping| HighlightCard["Navigate to Community Grid\n& Highlight Target Card"]
  Parser -->|Invalid / Expired| InfoBanner["Render InfoBanner\n& Capture deep_link_invalid"]
  Hydrate --> Telemetry["Capture deep_link_handled"]
  FocusAlert --> Telemetry
  HighlightCard --> Telemetry
```

## Step 28: Accessibility hardening

User/business impact:

Hardens Couture Cast on mobile and web toward WCAG 2.1 Level A and AA.
Automated checks provide regression evidence.
The release record states the limits of that evidence and the approved manual-testing exception, so it makes no claim of audited conformance.

Key takeaways:

1. Shared localized formatting: `packages/utils/src/accessibility.ts` provides `formatWeatherAltText`, `formatGarmentAltText`, and `getAnnouncementUrgency`, so every surface generates the same accessible text.
2. Web structure and keyboard traversal: every route exposes the same skip target and one main landmark.
   Ordinary cards stay out of the routine Tab order.
   The baseline web route inventory has no production modal, so no generic focus trap exists.
3. Contrast and motion tokens: `apps/web/src/app/globals.css` uses an Onyx essential outline on light surfaces, a white outline on dark surfaces, and a decorative gold halo.
   Forced colors remove the halo.
   Reduced motion disables nonessential movement.
4. Native mobile hooks: the rendered announcement provider localizes, deduplicates, and coalesces updates.
   The reduced-motion hook defaults safely, handles query failure and event races, and controls scrolling and modal animation.
5. Verification and evidence: the Story 3.8 Playwright matrix passed 21 cases.
   Lighthouse scored 1.00 on all four primary routes.
   The repository validation gate passed.
   The Maestro flow is selectable and blocking.
   Native-device and human assistive-technology checks are closed through permanent Compliance exception `A11Y-EX-001`.

Story/Task mapping:

- Story 3.8
- Task 1 (Shared localized accessibility formatting)
- Task 2 (Web structure and keyboard flow)
- Task 3 (Web focus appearance, contrast, and reduced motion)
- Task 4 (Native mobile semantics, modal behavior, and reduced motion)
- Task 5 (Browser component and interaction tests)
- Task 6 (Lighthouse CI and workflow enforcement)
- Task 7 (Mobile tests and executable Maestro flow)
- Task 8 (Manual protocol and executed release evidence)
- Task 9 (Workspace verification and completion gate)

Story reference:

- `_bmad-output/implementation-artifacts/3-8-accessibility-hardening.md`

Cross-links:

- Step 22 provides localization infrastructure (`apps/mobile/assets/locales/`).
- Step 25 provides Lookbook Prism responsive layout components.
- Step 26 provides chip filter arrow key navigation and sticky bottom bar.
- Step 27 provides deep-link focus management and alert banner scrolling.

Sequence to follow:

1. Read `packages/utils/src/accessibility.ts` for the weather and garment alt text helpers and the announcement urgency helper.
2. Inspect `apps/web/src/app/components/skip-to-content.tsx`, the route-level main landmarks, and `apps/web/src/app/globals.css` for web structure and surface-aware focus styling.
3. Inspect `apps/mobile/src/hooks/use-accessibility-announcer.ts` and `apps/mobile/src/hooks/use-reduced-motion.ts` for native screen reader and motion preference handling.
4. Review test suites in `packages/utils/src/accessibility.spec.ts`, `apps/web/src/app/components/accessibility-hardening.test.tsx`, `apps/mobile/src/screens/accessibility-hardening.test.tsx`, and `playwright/tests/accessibility-hardening.spec.ts`.

Task owner map:

- Story 3.8 Task 1 step 1 owner: implement shared localized accessibility formatting, alt text, and live announcement urgency helpers in `packages/utils/src/accessibility.ts`
- Story 3.8 Task 2 step 1 owner: implement SkipToContent link and main landmark focus target in `apps/web/src/app/components/skip-to-content.tsx`
- Story 3.8 Task 3 step 1 owner: define focus ring contrast tokens, forced-colors mode, and prefers-reduced-motion overrides in `apps/web/src/app/globals.css`
- Story 3.8 Task 4 step 1 owner: implement native mobile accessibility announcer hook in `apps/mobile/src/hooks/use-accessibility-announcer.ts`
- Story 3.8 Task 4 step 2 owner: implement native mobile reduced motion listener hook in `apps/mobile/src/hooks/use-reduced-motion.ts`
- Story 3.8 Task 5 step 1 owner: unit-test the web skip-link contract in `apps/web/src/app/components/accessibility-hardening.test.tsx`
- Story 3.8 Task 7 step 1 owner: unit-test mobile accessibility announcer and reduced motion hook in `apps/mobile/src/screens/accessibility-hardening.test.tsx`
- Story 3.8 Task 5 step 2 owner: E2E Playwright test skip-link activation, main landmark focus, and reduced-motion emulation in `playwright/tests/accessibility-hardening.spec.ts`
- Story 3.8 Task 5 step 3 owner: implement reusable AxeBuilder accessibility scanning helper in `playwright/support/helpers/accessibility.ts`

Tests that cover this step:

Shared accessibility unit test:

- [`packages/utils/src/accessibility.spec.ts`](../../packages/utils/src/accessibility.spec.ts): proves localized weather and garment descriptions, invalid-value fallbacks, Fahrenheit output, and announcement urgency.

Web unit and component tests:

- [`apps/web/src/app/components/accessibility-hardening.test.tsx`](../../apps/web/src/app/components/accessibility-hardening.test.tsx): proves the skip link and route content share one focusable main target.
- [`apps/web/src/app/components/community-lookbook-grid.test.tsx`](../../apps/web/src/app/components/community-lookbook-grid.test.tsx): proves failed-image cards stay programmatically focusable without adding a routine Tab stop.
- [`apps/web/src/app/components/lookbook-prism-layout.test.tsx`](../../apps/web/src/app/components/lookbook-prism-layout.test.tsx): proves semantic reading order, static-card Tab behavior, and reduced-motion rendering.
- [`apps/web/src/app/components/chip-navigation.test.tsx`](../../apps/web/src/app/components/chip-navigation.test.tsx): proves pressed-state semantics, arrow-key traversal, visible focus targets, status announcements, and clean Tab exit.

Mobile unit and component tests:

- [`apps/mobile/src/screens/accessibility-hardening.test.tsx`](../../apps/mobile/src/screens/accessibility-hardening.test.tsx): proves announcement coalescing, assertive priority, deduplication, and reduced-motion default, update, and rejection behavior.
- [`apps/mobile/components/chip-navigation.test.tsx`](../../apps/mobile/components/chip-navigation.test.tsx): proves native chip accessibility state follows selection.

Playwright end-to-end tests:

- [`playwright/tests/accessibility-hardening.spec.ts`](../../playwright/tests/accessibility-hardening.spec.ts): proves route landmarks, Axe results, skip-link order, keyboard paths, deep-link focus, validation status, reduced motion, forced colors, focus outlines, and contrast across the tested viewport matrix.
- [`playwright/tests/chip-navigation-bottom-nav.spec.ts`](../../playwright/tests/chip-navigation-bottom-nav.spec.ts): proves the browser chip path works by keyboard and shows a visible focus ring.

Mobile end-to-end test:

- [`maestro/accessibility-hardening.yaml`](../../maestro/accessibility-hardening.yaml): exercises identifiers and selected state across bottom tabs, chips, garment swapping, and modal close behavior.
  It does not verify screen-reader speech or visual contrast.

Architecture diagram:

```mermaid
flowchart TD
  User[User / Screen Reader / Keyboard] --> Web[apps/web / apps/mobile]
  Web --> SkipLink["SkipToContent (#main-content)"]
  Web --> FocusRing["Surface Contrast Outline\nDecorative Gold Halo"]
  Web --> ReducedMotion["Prefers Reduced Motion Overrides"]
  Web --> AltText["formatWeatherAltText & formatGarmentAltText\n(packages/utils/src/accessibility.ts)"]
  Web --> Announcer["aria-live / AccessibilityInfo.announceForAccessibility"]
```

## Step 29: Garment capture flow

User/business impact:

Users photograph or upload clothing into a private wardrobe with the camera or a file picker.
They can crop to a set aspect ratio, preview automatic background-cleanup matting, and watch byte-level upload progress.
Teen uploads require guardian consent.
For the business, this feeds personalized, weather-driven outfit recommendations.
Storage stays private, teen handling follows COPPA/GDPR, and telemetry and server logs carry no private data.

Key takeaways:

1. Consent-aware authorization: `GuardianService.assertWardrobeUploadAllowed` reads the user's age and active, unrevoked guardian consent from Postgres before it issues an upload session or commits a garment for a teen account (ages 13-15).
2. Opaque single-use HMAC upload relay: clients request a signed session (`POST /api/v1/wardrobe/upload-url`) and stream image bytes (`PUT /api/v1/wardrobe/uploads/{uploadSessionId}`) straight to NestJS server memory.
   The server checks the single-use HMAC token, verifies the SHA-256 checksum, and caps the payload at 10MB.
3. Strict OpenAPI and shared HTTP contracts: `@couture/api-client/contracts/http` defines strict Zod schemas (`.strict()`) for session allocation, binary relay, and garment commit.
   They reject unknown fields and client-supplied ownership parameters.
4. Web and mobile capture UI: `GarmentCaptureModal` on web and the native capture components on mobile provide live camera capture (`MediaDevices.getUserMedia`), a cropper (`1:1` and `4:3`), a background matting preview toggle, `aria-live="polite"` status regions, and retry after errors.
5. Privacy telemetry and redaction: the `garment_upload_completed` event carries only a pseudonymous subject ID, `garment_id`, `file_size_bytes`, `mime_type`, `has_cropping`, `has_bg_cleanup`, and `duration_ms`.
   PostHog IP capture is disabled, and the Pino logger redacts tokens.

Story/Task mapping:

- Story 4.1
- Task 1 (Database schema & lifecycle migration)
- Task 2 (Private storage configuration & RLS policies)
- Task 3 (Fresh wardrobe-consent authorization guard)
- Task 4 (Canonical Wardrobe HTTP contracts & Zod schemas)
- Task 5 (NestJS Wardrobe API controller, service & upload relay)
- Task 6 (Processing lifecycle integration)
- Task 7 (Strict telemetry & logger redaction)
- Task 8 (Responsive web capture modal & page)
- Task 9 (Native mobile capture experience)
- Task 10 (Retention cleanup & deletion workflow)
- Task 11 (Quality matrix & accessibility validation)

Story reference:

- `_bmad-output/implementation-artifacts/4-1-garment-capture-flow.md`

Cross-links:

- Step 3 provides Prisma schema conventions (`GarmentItem`, `GarmentUploadStatus`, `GarmentRetentionStatus`).
- Step 4 provides Supabase environment isolation and private RLS policies (`wardrobe-images` bucket).
- Step 14 provides guardian consent state and teen role verification.
- Step 28 provides accessible modal structure, landmark focus targets, and `aria-live` status regions.

Sequence to follow:

1. Read `packages/db/prisma/schema.prisma` for the `GarmentUploadStatus` enums and the `GarmentItem` fields (`object_path`, `upload_session_id`, `upload_status`, `retention_status`).
2. Read `packages/api-client/src/contracts/http/wardrobe.ts` for the strict Zod input and output schemas and the `uploadGarmentBytes` transport helper.
3. Inspect `apps/api/src/modules/guardian/guardian.service.ts` and `apps/api/src/modules/wardrobe/wardrobe.guard.ts` for teen guardian consent checks.
4. Inspect `apps/api/src/modules/wardrobe/wardrobe.service.ts` and `wardrobe.controller.ts` for HMAC token generation, the binary upload relay, checksum validation, and garment commit.
5. Read `apps/web/src/app/components/garment-capture-modal.tsx` and `apps/web/src/app/wardrobe/page.tsx` for the web capture UI, cropping, background matting preview, and progress feedback.
6. Review test suites in `packages/api-client/testing/wardrobe-contract.spec.ts`, `apps/api/src/modules/wardrobe/wardrobe.service.spec.ts`, `apps/web/src/app/components/garment-capture-modal.test.tsx`, `playwright/tests/wardrobe-garment-capture.spec.ts`, and `maestro/garment-capture-flow.yaml`.

Task owner map:

- Story 4.1 Task 3 step 1 owner: assertWardrobeUploadAllowed for teen guardian consent verification in `apps/api/src/modules/guardian/guardian.service.ts`
- Story 4.1 Task 4 step 1 owner: define Zod request and response envelope schemas and uploadGarmentBytes helper in `packages/api-client/src/contracts/http/wardrobe.ts`
- Story 4.1 Task 5 step 1 owner: expose Wardrobe API endpoints for upload url allocation, binary upload relay, and garment commit in `apps/api/src/modules/wardrobe/wardrobe.controller.ts`
- Story 4.1 Task 5 step 2 owner: implement HMAC upload tokens, checksum validation, and garment commit logic in `apps/api/src/modules/wardrobe/wardrobe.service.ts`
- Story 4.1 Task 5 step 3 owner: implement WardrobeUploadGuard after auth guard in `apps/api/src/modules/wardrobe/wardrobe.guard.ts`
- Story 4.1 Task 7 step 1 owner: define garment_upload_completed analytics event and track wrapper in `packages/api-client/src/types/analytics-events.ts`
- Story 4.1 Task 8 step 1 owner: implement web garment capture modal component with camera, cropping, background cleanup preview, and ARIA live regions in `apps/web/src/app/components/garment-capture-modal.tsx`
- Story 4.1 Task 8 step 2 owner: implement web wardrobe hub page in `apps/web/src/app/wardrobe/page.tsx`
- Story 4.1 Task 8 step 3 owner: unit-test web garment capture modal dialog rendering and close interaction in `apps/web/src/app/components/garment-capture-modal.test.tsx`
- Story 4.1 Task 8 step 4 owner: E2E Playwright test for wardrobe capture modal accessibility and landmark visibility in `playwright/tests/wardrobe-garment-capture.spec.ts`
- Story 4.1 Task 9 step 1 owner: Maestro E2E test script for mobile garment capture flow in `maestro/garment-capture-flow.yaml`

Tests that cover this step:

Real-PostgreSQL database tests:

- [`packages/db/test/garment-upload-schema.spec.ts`](../../packages/db/test/garment-upload-schema.spec.ts): proves upload lifecycle defaults, constraints, private storage setup, grants, and supporting indexes against PostgreSQL.
- [`packages/db/test/rls/guardian-wardrobe.spec.ts`](../../packages/db/test/rls/guardian-wardrobe.spec.ts) and [`packages/db/test/rls/identity-and-admin.spec.ts`](../../packages/db/test/rls/identity-and-admin.spec.ts): prove owner, guardian, admin, and cross-user wardrobe access rules against PostgreSQL.

Fixture and shared contract unit tests:

- [`packages/testing/test/wardrobe-item.factory.spec.ts`](../../packages/testing/test/wardrobe-item.factory.spec.ts): proves fixture lifecycle states, persistence mappings, relationships, and cleanup registration.
- [`packages/utils/src/wardrobe-object-path.spec.ts`](../../packages/utils/src/wardrobe-object-path.spec.ts): proves garment object paths stay inside the expected user and garment namespace.
- [`packages/api-client/testing/wardrobe-contract.spec.ts`](../../packages/api-client/testing/wardrobe-contract.spec.ts): proves upload allocation, binary relay, commit schemas, route metadata, and the byte-upload helper contract.
- [`packages/api-client/testing/analytics-events.spec.ts`](../../packages/api-client/testing/analytics-events.spec.ts): proves upload analytics keep the subject out of the provider property bag and keep only the canonical upload fields.

API unit and boundary tests:

- [`apps/api/src/modules/guardian/guardian.service.spec.ts`](../../apps/api/src/modules/guardian/guardian.service.spec.ts): proves wardrobe upload eligibility follows age and fresh guardian consent.
- [`apps/api/src/modules/wardrobe/wardrobe.guard.spec.ts`](../../apps/api/src/modules/wardrobe/wardrobe.guard.spec.ts): proves the authenticated actor reaches the wardrobe authorization decision and denials stop the request.
- [`apps/api/src/modules/wardrobe/wardrobe-image-validation.spec.ts`](../../apps/api/src/modules/wardrobe/wardrobe-image-validation.spec.ts): proves decoded image bytes must agree with the declared MIME type, size, dimensions, and checksum.
- [`apps/api/src/modules/wardrobe/wardrobe-storage.adapter.spec.ts`](../../apps/api/src/modules/wardrobe/wardrobe-storage.adapter.spec.ts): proves private-bucket writes, reads, removals, credential failure, and normalized storage errors.
- [`apps/api/src/modules/wardrobe/wardrobe-upload-token.spec.ts`](../../apps/api/src/modules/wardrobe/wardrobe-upload-token.spec.ts): proves upload-token signing, verification, expiry, tamper rejection, and secret requirements.
- [`apps/api/src/modules/wardrobe/wardrobe-processing.queue.spec.ts`](../../apps/api/src/modules/wardrobe/wardrobe-processing.queue.spec.ts): proves garment processing jobs carry stable payloads and deduplicate the same upload attempt.
- [`apps/api/src/modules/wardrobe/wardrobe.controller.spec.ts`](../../apps/api/src/modules/wardrobe/wardrobe.controller.spec.ts): proves allocation, raw-byte upload, commit validation, delegation, and fresh-versus-replay statuses at the controller boundary.
- [`apps/api/src/modules/wardrobe/wardrobe.service.regression.spec.ts`](../../apps/api/src/modules/wardrobe/wardrobe.service.regression.spec.ts): proves the allocation, byte upload, checksum, commit, idempotency, and processing-enqueue lifecycle.
- [`apps/api/src/modules/wardrobe/wardrobe.service.failure-paths.spec.ts`](../../apps/api/src/modules/wardrobe/wardrobe.service.failure-paths.spec.ts): proves upload and commit failures release claims, clean stored objects, keep retryability, and surface stable errors.
- [`apps/api/src/modules/wardrobe/wardrobe-retention.service.spec.ts`](../../apps/api/src/modules/wardrobe/wardrobe-retention.service.spec.ts): proves deletion purges source and derived garment data, legal hold preserves it, and expired pending uploads are claimed idempotently.
- [`apps/api/src/modules/telemetry/telemetry.service.spec.ts`](../../apps/api/src/modules/telemetry/telemetry.service.spec.ts): proves upload events use a pseudonymous subject, validated properties, independent sinks, and disabled provider IP capture.

Web and Mobile component/client tests:

- [`apps/web/src/app/components/garment-capture-modal.test.tsx`](../../apps/web/src/app/components/garment-capture-modal.test.tsx): proves camera and file capture, crop and cleanup choices, validation, progress, retry, dialog semantics, and focus restoration.
- [`apps/web/src/app/wardrobe/page.test.tsx`](../../apps/web/src/app/wardrobe/page.test.tsx): proves the wardrobe hub opens capture, reconciles committed garments, polls processing state, and renders failure recovery.
- [`apps/web/src/lib/wardrobe.test.ts`](../../apps/web/src/lib/wardrobe.test.ts): proves allocation, binary upload, and commit requests use canonical schemas, headers, status handling, and abort signals.
- [`apps/mobile/components/wardrobe/garment-capture-modal.test.tsx`](../../apps/mobile/components/wardrobe/garment-capture-modal.test.tsx): proves native camera and library capture, upload lifecycle, progress, retry, consent errors, and accessible modal controls.

Playwright end-to-end test:

- [`playwright/tests/wardrobe-garment-capture.spec.ts`](../../playwright/tests/wardrobe-garment-capture.spec.ts): proves the wardrobe page opens the capture dialog with the expected landmark and accessible surface.

Mobile end-to-end test:

- [`maestro/garment-capture-flow.yaml`](../../maestro/garment-capture-flow.yaml): exercises fixture photo selection, crop options, capture completion, and return to the garment list in a built app.

Architecture diagram:

```mermaid
flowchart TD
  Client["Web / Mobile App\n(GarmentCaptureModal / Camera)"] --> Alloc["POST /api/v1/wardrobe/upload-url\n(WardrobeUploadGuard + GuardianService)"]
  Alloc --> Session["GarmentItem (pending_upload)\n+ Opaque HMAC Token"]
  Client --> Upload["PUT /api/v1/wardrobe/uploads/{sessionId}\n(Binary Upload Relay + SHA-256 Checksum)"]
  Upload --> Storage["Write to Supabase Storage\nwardrobe-images/wardrobe/{userId}/{garmentId}.png"]
  Upload --> BytesUploaded["GarmentItem (bytes_uploaded)"]
  Client --> Commit["POST /api/v1/wardrobe/garments\n(Commit & Telemetry)"]
  Commit --> Processing["GarmentItem (processing)\n+ garment_upload_completed Event"]
```

## Step 30: Smart tagging and comfort metadata

User/business impact:

1. User uploads clothing photo.
2. Backend AI compares photo with fixed clothing labels.
3. AI guesses category and material.
4. Plain TypeScript rules turn those guesses into a comfort range.
5. User confirms or fixes the tags.
   User has final say.

What "AI" means here:

- FashionCLIP is a pretrained image classifier.
  It runs through ONNX and Transformers.js.
- It compares the image with fixed text prompts such as `a photo of a coat` and `a garment made from wool`, and returns a score for each prompt.
- FashionCLIP is an image-text classifier.
  Tagging runs without a large language model.
  It generates no content, and it does not learn from wardrobe photos or fine-tune itself.
- "Local" means local to the backend wardrobe worker.
  The model does not run on the phone or in the browser.
- Model preparation downloads one pinned FashionCLIP snapshot from Hugging Face and verifies its SHA-256 hashes.
  Runtime inference loads those local files with remote model access disabled.

How the app uses it:

1. Garment commit adds a BullMQ `color-extraction` job.
2. A dedicated wardrobe worker process downloads the stored image.
3. `FashionClipTaggingEngine` sends the image to a separate Node worker thread.
   The thread runs one inference request at a time, so model work does not block API requests or overlap in memory.
4. FashionCLIP scores six category prompts and nine material prompts.
   The API converts the scores into probabilities and confidence flags.
5. Category is confident at score `0.55` with a `0.15` lead.
   Material is confident at score `0.45` with a `0.10` lead.
   Low-confidence values require user review.
6. TypeScript rules derive `cold`, `cool`, `mild`, `warm`, or `hot`.
   For example, wool maps to `cold` and linen maps to `hot`.
   FashionCLIP does not predict this field directly.
7. The worker stores the suggestions and moves the garment to `awaiting_tags`.
8. Web or Mobile asks the user to confirm or correct the tags.
   Both clients support ten locales, accessible radio choices, and screen reader status.
   Confirmation uses `PATCH /api/v1/wardrobe/garments/{garmentId}/tags` and moves the garment to `ready`.
9. Confirmation records telemetry and clears the Ritual cache so future outfits use the new tags.
10. If inference fails, the garment still moves to `awaiting_tags`.
    The user can enter tags manually.
    If the dedicated wardrobe worker is not running, queued garments stay in `processing`, so production must deploy the worker and the verified model snapshot with the API.

Stored data:

- `tag_suggestions`: values, confidence scores, confidence flags, and model version.
- `tagging_failure_code`: why inference failed, when applicable.
- `tags_confirmed_at`: when the user accepted or corrected the tags.
- `awaiting_tags`: processing finished and user confirmation is required.

Story/Task mapping:

- Story 4.2
- Task 1 (Database schema & lifecycle migration)
- Task 2 (ONNX tagging engine & worker thread isolation)
- Task 3 (BullMQ queue processing & failure recovery)
- Task 4 (Canonical Wardrobe HTTP contracts & Zod schemas)
- Task 5 (NestJS Wardrobe API controller & service methods)
- Task 6 (Telemetry & ritual cache invalidation integration)
- Task 7 (Responsive web tagging modal & hub page)
- Task 8 (Native mobile tagging experience & 10 locale translations)
- Task 9 (Quality matrix & accessibility validation)

Story reference:

- `_bmad-output/implementation-artifacts/4-2-smart-tagging-comfort-metadata.md`

Cross-links:

- Step 3 provides Prisma schema conventions (`GarmentItem`, `GarmentCategory`, `GarmentMaterial`, `GarmentComfortRange`).
- Step 5 provides BullMQ worker concurrency and DLQ-style failure capture patterns.
- Step 22 provides mobile multi-locale translation infrastructure (`apps/mobile/assets/locales/`).
- Step 29 provides the garment upload relay and the `processing` state that triggers color extraction and AI tagging.

Sequence to follow:

1. Read `packages/db/prisma/schema.prisma` for the `GarmentCategory`, `GarmentMaterial`, and `GarmentComfortRange` enums and the `GarmentItem` smart tagging fields.
2. Inspect `apps/api/src/modules/wardrobe/garment-tagging.engine.ts` and `apps/api/src/modules/wardrobe/fashion-clip-tagging.engine.ts` for the pluggable inference engine and worker thread execution.
3. Inspect `apps/api/src/modules/wardrobe/wardrobe-color.processor.ts` for BullMQ job handling, AI tag inference, and the recoverable failure fallback (`TAGGING_INFERENCE_FAILED`).
4. Read `packages/api-client/src/contracts/http/wardrobe.ts` for the `suggestGarmentTags` and `updateGarmentTags` contracts.
5. Inspect `apps/api/src/modules/wardrobe/wardrobe.service.ts` and `wardrobe.controller.ts` for suggestion reads, user override calculation (`wasOverridden`), telemetry, and ritual cache invalidation.
6. Read `apps/web/src/app/components/garment-tagging-modal.tsx` and `apps/mobile/components/wardrobe/garment-tagging-modal.tsx` for the web and mobile modal flows.
7. Review test suites in `apps/api/src/modules/wardrobe/fashion-clip-tagging.engine.spec.ts`, `apps/api/src/modules/wardrobe/wardrobe-color.processor.spec.ts`, `apps/api/src/modules/wardrobe/wardrobe.service.spec.ts`, `packages/api-client/testing/wardrobe-contract.spec.ts`, `apps/web/src/app/components/garment-tagging-modal.test.tsx`, `apps/mobile/components/wardrobe/garment-tagging-modal.test.tsx`, and `playwright/tests/wardrobe-smart-tagging.spec.ts`.

Task owner map:

- Story 4.2 Task 1 step 1 owner: add garment smart tagging metadata fields and awaiting_tags upload status to Prisma schema in packages/db/prisma/schema.prisma
- Story 4.2 Task 2 step 1 owner: implement pluggable GarmentTaggingEngine interface and confidence scoring in apps/api/src/modules/wardrobe/garment-tagging.engine.ts
- Story 4.2 Task 2 step 2 owner: implement FashionClipTaggingEngine ONNX inference engine in apps/api/src/modules/wardrobe/fashion-clip-tagging.engine.ts
- Story 4.2 Task 2 step 3 owner: implement FixtureGarmentTaggingEngine fallback engine in apps/api/src/modules/wardrobe/fixture-garment-tagging.engine.ts
- Story 4.2 Task 3 step 1 owner: integrate smart tagging inference into BullMQ wardrobe color processor in apps/api/src/modules/wardrobe/wardrobe-color.processor.ts
- Story 4.2 Task 4 step 1 owner: define suggestGarmentTags and updateGarmentTags HTTP contracts and Zod schemas in packages/api-client/src/contracts/http/wardrobe.ts
- Story 4.2 Task 5 step 1 owner: implement suggestGarmentTags and updateGarmentTags service methods in apps/api/src/modules/wardrobe/wardrobe.service.ts
- Story 4.2 Task 5 step 2 owner: expose suggestGarmentTags and updateGarmentTags API endpoints in apps/api/src/modules/wardrobe/wardrobe.controller.ts
- Story 4.2 Task 6 step 1 owner: define garment_tagging_completed analytics event schema in packages/api-client/src/types/analytics-events.ts
- Story 4.2 Task 7 step 1 owner: implement web garment tagging modal dialog component in apps/web/src/app/components/garment-tagging-modal.tsx
- Story 4.2 Task 8 step 1 owner: implement native mobile garment tagging modal component in apps/mobile/components/wardrobe/garment-tagging-modal.tsx
- Story 4.2 Task 9 step 1 owner: E2E Playwright test for smart tagging modal accessibility and flow in playwright/tests/wardrobe-smart-tagging.spec.ts

Tests that cover this step:

Real-PostgreSQL database tests:

- [`packages/db/test/garment-upload-schema.spec.ts`](../../packages/db/test/garment-upload-schema.spec.ts): proves smart-tagging enums, lifecycle columns, JSON constraints, confirmation fields, and supporting indexes against PostgreSQL.
- [`packages/db/test/rls/guardian-wardrobe.spec.ts`](../../packages/db/test/rls/guardian-wardrobe.spec.ts): proves tagging metadata stays scoped by the wardrobe row-level security policy.

Shared contract unit tests:

- [`packages/api-client/testing/wardrobe-contract.spec.ts`](../../packages/api-client/testing/wardrobe-contract.spec.ts): proves suggestion, confirmation, lifecycle, failure-code, and OpenAPI route schemas.
- [`packages/api-client/testing/analytics-events.spec.ts`](../../packages/api-client/testing/analytics-events.spec.ts): proves tagging analytics normalization, null-suggestion handling, override invariants, duplicate rejection, and privacy-safe provider properties.

Inference and worker unit tests:

- [`apps/api/src/modules/wardrobe/garment-tagging.engine.spec.ts`](../../apps/api/src/modules/wardrobe/garment-tagging.engine.spec.ts): proves confidence thresholds, lead margins, probability normalization, and comfort-range derivation.
- [`apps/api/src/modules/wardrobe/fashion-clip-tagging.engine.spec.ts`](../../apps/api/src/modules/wardrobe/fashion-clip-tagging.engine.spec.ts): proves snapshot-resolution failures, direct-logit extraction, embedding-derived logits, and invalid or non-finite output rejection.
- [`apps/api/src/modules/wardrobe/fashion-clip-tagging.engine.lifecycle.spec.ts`](../../apps/api/src/modules/wardrobe/fashion-clip-tagging.engine.lifecycle.spec.ts): proves worker startup, request correlation, validated suggestion projection, timeouts, failure replacement, reuse, and shutdown behavior.
- [`apps/api/src/modules/wardrobe/fashion-clip-inference.worker.spec.ts`](../../apps/api/src/modules/wardrobe/fashion-clip-inference.worker.spec.ts): proves model-session loading, serialized inference, tensor output parsing, and worker error replies.
- [`apps/api/src/modules/wardrobe/garment-tagging.smoke.spec.ts`](../../apps/api/src/modules/wardrobe/garment-tagging.smoke.spec.ts): exercises the prepared FashionCLIP snapshot when the optional real-model smoke environment is available.
- [`apps/api/src/modules/wardrobe/wardrobe-color.processor.spec.ts`](../../apps/api/src/modules/wardrobe/wardrobe-color.processor.spec.ts): proves image download, tag inference, `awaiting_tags` persistence, failure fallback, and retry boundaries in the BullMQ processor.

API unit and boundary tests:

- [`apps/api/src/modules/wardrobe/wardrobe.controller.spec.ts`](../../apps/api/src/modules/wardrobe/wardrobe.controller.spec.ts): proves suggestion and confirmation routes validate ids, bodies, output envelopes, delegation, and HTTP status behavior.
- [`apps/api/src/modules/wardrobe/wardrobe.service.spec.ts`](../../apps/api/src/modules/wardrobe/wardrobe.service.spec.ts): proves eligible suggestion reads, confirmation overrides, ready-state transitions, telemetry, and Ritual cache invalidation.
- [`apps/api/src/modules/wardrobe/wardrobe.service.regression.spec.ts`](../../apps/api/src/modules/wardrobe/wardrobe.service.regression.spec.ts): proves tagging stays connected to the pre-existing garment upload lifecycle.
- [`apps/api/src/modules/wardrobe/wardrobe.service.failure-paths.spec.ts`](../../apps/api/src/modules/wardrobe/wardrobe.service.failure-paths.spec.ts): proves invalid lifecycle states, stale or missing garments, telemetry failures, and cache-clear failures do not corrupt confirmed tags.
- [`apps/api/src/modules/personalization/ritual.service.spec.ts`](../../apps/api/src/modules/personalization/ritual.service.spec.ts): proves only ready, tagged garments are eligible for outfit selection and cache reuse respects wardrobe changes.
- [`apps/api/src/modules/telemetry/telemetry.service.spec.ts`](../../apps/api/src/modules/telemetry/telemetry.service.spec.ts): proves garment-tagging events are pseudonymized and limited to allowlisted properties.

Web and Mobile component/client tests:

- [`apps/web/src/app/components/garment-tagging-modal.test.tsx`](../../apps/web/src/app/components/garment-tagging-modal.test.tsx): proves suggestions, confidence guidance, manual overrides, validation, save states, errors, accessibility, and focus restoration.
- [`apps/web/src/app/wardrobe/page.test.tsx`](../../apps/web/src/app/wardrobe/page.test.tsx): proves the hub moves a processed garment through `awaiting_tags` to `ready` and refreshes its displayed metadata.
- [`apps/web/src/lib/wardrobe.test.ts`](../../apps/web/src/lib/wardrobe.test.ts): proves suggestion and confirmation client calls validate canonical requests and responses.
- [`apps/mobile/components/wardrobe/garment-tagging-modal.test.tsx`](../../apps/mobile/components/wardrobe/garment-tagging-modal.test.tsx): proves the native suggestion, correction, save, error, and accessibility flow.
- [`apps/mobile/src/lib/wardrobe.test.ts`](../../apps/mobile/src/lib/wardrobe.test.ts): proves the native suggestion client keeps the structured API error codes the tagging modal uses.
- [`apps/mobile/src/i18n/wardrobe-tagging-locales.spec.ts`](../../apps/mobile/src/i18n/wardrobe-tagging-locales.spec.ts): proves all supported Mobile catalogs contain complete, non-placeholder tagging copy.

Pact contract tests:

- [`pact/http/consumer/mobile-api-client.pacttest.ts`](../../pact/http/consumer/mobile-api-client.pacttest.ts): defines Mobile's expected suggestion and tag-confirmation interactions against the Pact mock server.
- [`pact/http/consumer/web-api-client.pacttest.ts`](../../pact/http/consumer/web-api-client.pacttest.ts): defines Web's expected suggestion and tag-confirmation interactions against the Pact mock server.
- [`pact/http/provider/api-provider.pacttest.ts`](../../pact/http/provider/api-provider.pacttest.ts): replays generated tagging interactions against the Nest provider controllers and scenario-controlled service doubles.

Playwright end-to-end test:

- [`playwright/tests/wardrobe-smart-tagging.spec.ts`](../../playwright/tests/wardrobe-smart-tagging.spec.ts): proves upload, background processing, suggested tags, user override, save, ready-state persistence, and accessibility through the browser flow.

Mobile end-to-end test:

- [`maestro/garment-smart-tagging-flow.yaml`](../../maestro/garment-smart-tagging-flow.yaml): exercises capture, suggestion review, tag correction, save, app restart, and persisted ready state in a built app.

Current repo note:

The standalone AI section near the top owns the plain-English explanation and architecture diagram.
This numbered step stays the traceability and code-reading reference for Story 4.2.

## Step 31: Outfit capsule builder

User/business impact:

Users group ready garments into reusable outfit capsules tagged by occasion (work, casual, formal, sport, travel, evening, outdoor, home).
They can find, reuse, favorite, repair, and delete capsules on web and mobile.
Qualifying capsules feed the weather-aware recommendation engine.
For the business, users pick an outfit once and reuse it, which drives retention.

Key takeaways:

1. **Composite same-owner keys.**
   `OutfitCapsule` and `OutfitCapsuleGarment` bind every relation by `(id, user_id)`, so a join can never cross tenants.
   A capsule holds 2 to 10 distinct garments in an explicit order, and a database check keeps `garment_order` between 0 and 9.
2. **Strong ETags, checked under lock.**
   Mutations require `If-Match: "capsule:<capsuleId>:<revision>"`.
   The precondition is checked again _inside_ the transaction while the row is locked.
   Checking it before the transaction lets two callers holding the same ETag both commit, which is a lost update that no test with a mocked database can catch.
3. **One shared lock order.**
   Capsule mutation and `WardrobeRetentionService` lock the same rows in the same order: owner `UserProfile`, then affected capsules by id, then garments by id.
   A different order between the two paths deadlocks; no lock at all leaves the garment eligibility check racing a purge.
4. **Eligibility is two conditions.**
   A garment may join a capsule only when `upload_status = 'ready'` **and** `retention_status = 'active'`.
   Checking retention alone admits a garment whose upload never finished.
5. **Durable telemetry.**
   Every state change writes a `CapsuleTelemetryClaim` row inside its own transaction, keyed uniquely on capsule id, committed revision, and event name.
   Delivery happens after commit and retries from the claim.
   An in-process `capture()` call loses the event if the process dies between commit and flush.
6. **Two independent freshness checks.**
   The capsule revision is stamped into both the Redis payload and the persisted recommendation and compared on read.
   Clearing Redis after a mutation is only an optimization; the revision check is what stops a degraded Redis from serving a stale capsule.
7. **Button-based reordering.**
   Each selected garment has labelled Move up and Move down controls.
   After a move, focus stays on a _usable_ control.
   At a boundary the control just pressed becomes disabled, and focusing a disabled button silently drops the user on `<body>`.

Hard-won lessons from the code review of this story:

- A green suite over mocked persistence says nothing about real persistence.
  This story shipped 530 passing tests while every capsule write raised `relation "user_profiles" does not exist`, because the lock code sat behind `if (typeof tx.$executeRaw === 'function')` and the mock had no such method.
  Test doubles must model the real client surface; see `apps/api/src/testing/prisma-mock.ts`.
- At low volume, assert that an index is _available_.
  On a small table PostgreSQL correctly prefers a sequential scan, so asserting "must use the GIN index" is flaky.
  Explain the predicate in isolation with `enable_seqscan = off`.
- Prefer a database constraint the ORM can express.
  A column-specific `ON DELETE SET NULL` is valid PostgreSQL but cannot be written in `schema.prisma`, which would leave permanent `migrate diff` drift.

Story/Task mapping:

- Story 4.3
- Task 1 (Prisma schema, migration, RLS, revisioning)
- Task 2 (Wardrobe, ritual, and analytics contracts)
- Task 3 (Capsule authorization, controller, and service)
- Task 4 (Deterministic recommendation integration)
- Task 5 (Web capsule experience and localization)
- Task 6 (Mobile capsule experience and localization)
- Task 7 (Consumer and provider contracts)
- Task 8 (End-to-end and accessibility automation)
- Task 9 (Performance, determinism, and CI evidence)
- Task 10 (Verification gate)

Story reference:

- `_bmad-output/implementation-artifacts/4-3-outfit-capsule-builder.md`
- `_bmad-output/test-artifacts/story-4.3-release-qa.md`

Cross-links:

- Step 3 provides Prisma schema modeling and migration conventions.
- Step 4 provides Supabase environment isolation and guardian-aware RLS helpers.
- Step 19 provides the scenario outfit generator this story extends.
- Step 22 provides the localization pipeline and parity-test pattern.
- Step 28 provides the accessibility baseline the reorder controls build on.
- Steps 29 and 30 provide garment capture and smart tagging.

Sequence to follow:

1. `packages/db/prisma/schema.prisma` and `packages/db/prisma/migrations/20260807080000_add_outfit_capsules/migration.sql` for the models, composite keys, GIN and trigram indexes, RLS policies, and the telemetry claim table.
2. `packages/api-client/src/contracts/http/wardrobe.ts` for the canonical Zod contracts, including grapheme-bounded text via `Intl.Segmenter`.
3. `apps/api/src/modules/wardrobe/wardrobe-capsule.locks.ts` for the shared lock protocol, then `wardrobe-capsule.repository.ts` for how it is applied.
4. `wardrobe-capsule.service.ts` for ETag parsing, canonical normalization, and response projection; `wardrobe-capsule.outbox.ts` for durable telemetry.
5. `apps/api/src/modules/personalization/capsule-recommendation.engine.ts` for pure scoring and slot filling, then `ritual.service.ts` for how the winner is persisted and returned.
6. `apps/web/src/app/wardrobe/capsules/page.tsx` and `apps/mobile/app/wardrobe-capsules.tsx` for the two surfaces.
7. Tests, in order of what they prove:
   - `apps/api/integration/wardrobe-capsules.integration.spec.ts` (real PostgreSQL: locks, concurrency, rollback, idempotency races)
   - `apps/api/integration/wardrobe-capsules-query-plan.integration.spec.ts` (`EXPLAIN` evidence)
   - `apps/web/src/i18n/wardrobe-capsules-locales.spec.ts` and the mobile twin (49-key parity, placeholders, plurals, untranslated-value detection)

Task owner map:

- Story 4.3 Task 1 step 1 owner: define OutfitCapsule and OutfitCapsuleGarment models in packages/db/prisma/schema.prisma
- Story 4.3 Task 2 step 1 owner: define Outfit Capsule HTTP contracts and Zod schemas in packages/api-client/src/contracts/http/wardrobe.ts
- Story 4.3 Task 3 step 1 owner: implement the shared capsule lock protocol in apps/api/src/modules/wardrobe/wardrobe-capsule.locks.ts
- Story 4.3 Task 3 step 2 owner: implement WardrobeCapsuleRepository persistence and locking in apps/api/src/modules/wardrobe/wardrobe-capsule.repository.ts
- Story 4.3 Task 3 step 3 owner: implement WardrobeCapsuleService domain rules and ETag semantics in apps/api/src/modules/wardrobe/wardrobe-capsule.service.ts
- Story 4.3 Task 3 step 4 owner: expose WardrobeCapsuleController REST endpoints in apps/api/src/modules/wardrobe/wardrobe-capsule.controller.ts
- Story 4.3 Task 3 step 5 owner: persist and dispatch durable telemetry claims in apps/api/src/modules/wardrobe/wardrobe-capsule.outbox.ts
- Story 4.3 Task 4 step 1 owner: implement pure capsule scoring and slot filling in apps/api/src/modules/personalization/capsule-recommendation.engine.ts
- Story 4.3 Task 5 step 1 owner: implement web CapsuleBuilderModal component in apps/web/src/app/components/capsule-builder-modal.tsx
- Story 4.3 Task 5 step 2 owner: implement web wardrobe capsules page in apps/web/src/app/wardrobe/capsules/page.tsx
- Story 4.3 Task 5 step 3 owner: implement web locale resolution in apps/web/src/i18n/index.ts
- Story 4.3 Task 6 step 1 owner: implement native mobile CapsuleBuilderModal component in apps/mobile/components/wardrobe/capsule-builder-modal.tsx
- Story 4.3 Task 6 step 2 owner: implement the mobile capsule screen in apps/mobile/app/wardrobe-capsules.tsx
- Story 4.3 Task 8 step 1 owner: integration-test capsule locking and concurrency against real PostgreSQL in apps/api/integration/wardrobe-capsules.integration.spec.ts

Tests that cover this step:

Real-PostgreSQL database tests:

- [`packages/db/test/outfit-capsule-schema.spec.ts`](../../packages/db/test/outfit-capsule-schema.spec.ts): proves capsule defaults, ordered joins, constraints, indexes, cascades, row-level security, and grants against PostgreSQL.
- [`packages/db/test/rls/capsules.spec.ts`](../../packages/db/test/rls/capsules.spec.ts): proves owner, guardian, admin, stranger, and spoofing boundaries for capsules and ordered garment joins.

Shared contract unit tests:

- [`packages/api-client/testing/wardrobe-capsule-contract.spec.ts`](../../packages/api-client/testing/wardrobe-capsule-contract.spec.ts): proves grapheme-aware normalization and create, update, favorite, list, filter, response, and error schemas.
- [`packages/api-client/testing/wardrobe-capsule-analytics.spec.ts`](../../packages/api-client/testing/wardrobe-capsule-analytics.spec.ts): proves capsule analytics accept only the canonical privacy-safe property allowlists.

API unit and repository tests:

- [`apps/api/src/modules/wardrobe/wardrobe-access.service.spec.ts`](../../apps/api/src/modules/wardrobe/wardrobe-access.service.spec.ts): proves owner, admin, read-only guardian, full-consent guardian, and masked stranger authorization.
- [`apps/api/src/modules/wardrobe/wardrobe-capsule.normalize.spec.ts`](../../apps/api/src/modules/wardrobe/wardrobe-capsule.normalize.spec.ts): proves Unicode normalization, whitespace handling, canonical ordering, and stable payload hashing.
- [`apps/api/src/modules/wardrobe/wardrobe-capsule.controller.spec.ts`](../../apps/api/src/modules/wardrobe/wardrobe-capsule.controller.spec.ts): proves authentication, request validation, idempotency keys, ETags, `If-Match`, and create/list/update/favorite/delete status behavior.
- [`apps/api/src/modules/wardrobe/wardrobe-capsule.repository.spec.ts`](../../apps/api/src/modules/wardrobe/wardrobe-capsule.repository.spec.ts): proves owner scoping, shared lock order, eligibility, ordered joins, filtering, idempotency races, optimistic revisions, no-op detection, durable claims, and deletion.
- [`apps/api/src/modules/wardrobe/wardrobe-capsule.service.spec.ts`](../../apps/api/src/modules/wardrobe/wardrobe-capsule.service.spec.ts): proves strong ETag parsing, canonical payload rules, access checks, image signing, cache invalidation, telemetry dispatch, and mutation failure isolation.
- [`apps/api/src/modules/wardrobe/wardrobe-capsule.outbox.spec.ts`](../../apps/api/src/modules/wardrobe/wardrobe-capsule.outbox.spec.ts): proves in-transaction claim identity, delivery, replay suppression, failure recording, and bounded retry sweeps.
- [`apps/api/src/modules/personalization/capsule-recommendation.engine.spec.ts`](../../apps/api/src/modules/personalization/capsule-recommendation.engine.spec.ts): proves eligibility, occasion filters, comfort scoring, slot filling, favorite scoring, deterministic tie-breaks, and invalid-data exclusions.
- [`apps/api/src/modules/personalization/ritual.service.spec.ts`](../../apps/api/src/modules/personalization/ritual.service.spec.ts): proves capsule recommendations enter Rituals, report saved-capsule context, survive telemetry failure, and reject stale cached revisions.
- [`apps/api/src/modules/telemetry/telemetry.service.spec.ts`](../../apps/api/src/modules/telemetry/telemetry.service.spec.ts): proves capsule events stay persisted when no PostHog mapping exists and analytics delivery is skipped.

Real-infrastructure integration tests:

- [`apps/api/integration/wardrobe-capsules.integration.spec.ts`](../../apps/api/integration/wardrobe-capsules.integration.spec.ts): proves real-PostgreSQL locks, concurrent revisions, rollback, eligibility, ordered replacement, telemetry claims, idempotency races, and hard deletion.
- [`apps/api/integration/wardrobe-capsules-query-plan.integration.spec.ts`](../../apps/api/integration/wardrobe-capsules-query-plan.integration.spec.ts): proves the listing, search, occasion, favorite, and garment-filter indexes support their intended query shapes.

Web unit, component, and localization tests:

- [`apps/web/src/lib/wardrobe.test.ts`](../../apps/web/src/lib/wardrobe.test.ts): proves capsule client wrappers keep idempotency keys, ETags, filters, canonical responses, and server errors.
- [`apps/web/src/app/components/capsule-builder-modal.test.tsx`](../../apps/web/src/app/components/capsule-builder-modal.test.tsx): proves garment selection, occasion choices, limits, accessible reordering, validation, mutation states, and focus restoration.
- [`apps/web/src/app/wardrobe/capsules/page.test.tsx`](../../apps/web/src/app/wardrobe/capsules/page.test.tsx): proves create, edit, favorite, delete, filtering, ETag conflict repair, focus refresh, and superseded-request handling.
- [`apps/web/src/i18n/wardrobe-capsules-locales.spec.ts`](../../apps/web/src/i18n/wardrobe-capsules-locales.spec.ts): proves all supported Web catalogs have complete, meaningful capsule copy and valid plural forms.

Mobile unit, component, and localization tests:

- [`apps/mobile/src/lib/wardrobe.test.ts`](../../apps/mobile/src/lib/wardrobe.test.ts): proves the native client builds the documented strong capsule ETag.
- [`apps/mobile/components/wardrobe/capsule-builder-modal.test.tsx`](../../apps/mobile/components/wardrobe/capsule-builder-modal.test.tsx): proves native selection, occasion, limits, accessible move controls, save states, and validation.
- [`apps/mobile/src/screens/wardrobe-capsules-screen.test.tsx`](../../apps/mobile/src/screens/wardrobe-capsules-screen.test.tsx): proves native listing, create/edit, filtering, favorite, deletion, conflict repair, and lifecycle refresh.
- [`apps/mobile/src/i18n/wardrobe-capsules-locales.spec.ts`](../../apps/mobile/src/i18n/wardrobe-capsules-locales.spec.ts): proves all supported Mobile catalogs have complete, meaningful capsule copy and valid plural forms.

Pact contract tests:

- [`pact/http/consumer/mobile-api-client.pacttest.ts`](../../pact/http/consumer/mobile-api-client.pacttest.ts): defines Mobile's expected capsule CRUD, filter, conflict, and error interactions against the Pact mock server.
- [`pact/http/consumer/web-api-client.pacttest.ts`](../../pact/http/consumer/web-api-client.pacttest.ts): defines Web's expected capsule CRUD, filter, conflict, and error interactions against the Pact mock server.
- [`pact/http/provider/api-provider.pacttest.ts`](../../pact/http/provider/api-provider.pacttest.ts): replays generated capsule interactions against the Nest provider controllers and scenario-controlled service doubles.

Playwright end-to-end tests:

- [`playwright/tests/wardrobe-capsule-create.spec.ts`](../../playwright/tests/wardrobe-capsule-create.spec.ts): proves create, persisted garment order, second-client refresh, and combined filtering.
- [`playwright/tests/wardrobe-capsule-repair.spec.ts`](../../playwright/tests/wardrobe-capsule-repair.spec.ts): proves repair, favorite, and confirmed deletion journeys.
- [`playwright/tests/wardrobe-capsule-accessibility.spec.ts`](../../playwright/tests/wardrobe-capsule-accessibility.spec.ts): proves Axe results, keyboard-only creation, reorder focus and announcements, target size, dialog focus restoration, and named confirmation semantics.

Mobile end-to-end tests:

- [`maestro/garment-capsule-create-flow.yaml`](../../maestro/garment-capsule-create-flow.yaml): exercises native capsule creation and visible persistence.
- [`maestro/garment-capsule-repair-flow.yaml`](../../maestro/garment-capsule-repair-flow.yaml): exercises native repair, favorite, and saved-capsule recommendation handoff.
- [`maestro/garment-capsule-localization-flow.yaml`](../../maestro/garment-capsule-localization-flow.yaml): exercises localized capsule labels in a built app.

Performance test:

- [`k6/tests/couture-api-baseline.k6test.ts`](../../k6/tests/couture-api-baseline.k6test.ts): exercises capsule list, detail, search, create, update, favorite, delete, and cold-Ritual paths with endpoint-specific error-rate and environment-adjusted P95 thresholds.

Architecture diagram:

```mermaid
flowchart TD
  Client["Web / Mobile\n(CapsuleBuilderModal + capsule screen)"] --> MW["CapsuleCacheHeadersMiddleware\n(private, no-store on success and error)"]
  MW --> API["WardrobeCapsuleController\n(If-Match, Idempotency-Key, strong ETag)"]
  API --> Access["WardrobeAccessService\n(owner / guardian / admin, masked 404)"]
  API --> Service["WardrobeCapsuleService\n(NFC + grapheme rules, payload hash)"]
  Service --> Repo["WardrobeCapsuleRepository"]
  Repo --> Locks["lockOwnerProfile -> lockCapsules -> lockGarments"]
  Locks --> DB[("PostgreSQL\nOutfitCapsule, OutfitCapsuleGarment,\nCapsuleTelemetryClaim")]
  Retention["WardrobeRetentionService\n(same lock order)"] --> Locks
  Repo --> Claim["Telemetry claim written in-transaction"]
  Claim --> Outbox["CapsuleTelemetryOutbox\n(dispatch after commit, retry from claim)"]
  Service --> Cache["Clear Redis ritual keys\n(best effort)"]
  DB --> Engine["capsule-recommendation.engine\n(comfort, slots, tie-breaks)"]
  Engine --> Ritual["RitualService\n(capsule revision gates cache reuse)"]
```

## Step 32: Wardrobe onboarding and silhouette setup

User/business impact:

Guides a first-time user through closet setup: capture a starter wardrobe (or skip to one), tag garments, then model their body.
The body model is either two sliders (height, build) or a "My Form" photo processed into a moderated silhouette.
The guided onboarding screen and a standalone silhouette-settings surface share the same slider/My Form editor, since bodies and closets change after onboarding too.
The silhouette feeds the fit and comfort logic Steps 19-21 already use.
A completed silhouette is the strongest signal that a user will return, so the flow is forgiving.
Every step resumes on its own, and the last step ("Use starter wardrobe") lets a user skip capture without leaving the flow.

Key takeaways:

1. **Use advisory locks for singleton-per-user rows.**
   `WardrobeOnboardingState` and `SilhouetteProfile` hold one row per user, and that row does not exist yet on the user's first PATCH/PUT.
   `SELECT ... FOR UPDATE` cannot lock a row that is not there.
   `pg_advisory_xact_lock(hashtext('wardrobe_onboarding:' || userId))` locks the _key_, present row or not, so the create-or-advance branch in the same transaction is race-free from the first call.
   Run it with `$executeRaw`; `$queryRaw` cannot deserialize the lock function's `void` return (Prisma P2010).
2. **A job id keyed on a stable entity silently drops retries.**
   `SilhouettePhotoProcessingQueue` first keyed its BullMQ job on `silhouetteProfileId`.
   The garment queue can use that pattern because `GarmentItem` gets a fresh row per upload attempt; `SilhouetteProfile` is one row per _account_ for its whole lifetime.
   `Queue.add` with a used job id is a silent no-op while the earlier job sits in the 7-day retained completed set.
   So every My Form photo a user committed after their first (delete-and-reupload, or a retry after a flagged photo) was never enqueued, and the row sat in `processing` forever with no error anywhere.
   The fix keys on `buildSilhouettePhotoJobId(profileId, uploadSessionId)`.
   BullMQ rejects `:` in a custom job id, so the separator is `__`; a test caught that.
   A BullMQ job id must be unique per _unit of work_, and "unique per entity" means the same thing only when the entity is recreated per attempt.
3. **Exactly-once telemetry needs its own guard, and the guard must be cleared on failure.**
   Row creation makes "onboarding started" exactly-once only on the happy path.
   A crash between the state-machine commit and the analytics call needs an independent guard column (`started_telemetry_emitted_at` / `completed_telemetry_emitted_at`, mirroring `GarmentItem.completion_telemetry_emitted_at`).
   Stamp and clear the guard symmetrically.
   Stamping it before the emit call and leaving it set after a thrown or rejected emit makes the event unrecoverable forever, which is worse than the at-least-once duplicate the guard exists to prevent.
4. **A library bug can hide inside a pipeline that looks correct.**
   In Sharp 0.34.5, `.stats()` chained directly after `.extract()` on the same pipeline reports the _pre-crop_ image's statistics.
   Comparing raw pixel bytes against the reported stats confirmed it.
   The moderation engine's border-vs-center contrast check materializes each crop to its own buffer via `.raw().toBuffer()`, reopens it with a fresh `sharp()` instance and explicit `{ raw: { width, height, channels } }`, and then calls `.stats()`.
   A comment at the call site keeps a later "simplification" from putting the bug back.
5. **The state machine is forward-only and server-authoritative, including its own completion payload.**
   `advanceStep` accepts a `targetStep`.
   The client cannot send a garment count for the completion telemetry event; the service counts real `ready`/`awaiting_tags` `GarmentItem` rows created since `started_at`, at the transition into `silhouette`.
   An optional flag that matters on one transition (`usedStarterWardrobe`, meaningful only from capture to silhouette) still needs to be _sticky_: `input.usedStarterWardrobe ?? existing.used_starter_wardrobe`.
   Defaulting it to `false` when a later PATCH omits it silently overwrites a real prior answer.
6. **A photo session's state changes need the same revision discipline as the resource they attach to.**
   `createMyFormUploadUrl` and `uploadMyFormBytes` mutate `SilhouetteProfile.my_form_status` without incrementing `revision`.
   So a client's cached ETag stays valid across a transition that changed the response body (`myForm: null` to `myForm.status: 'pending_upload'`).
   When a route's response shape depends on a sub-object's status, the ETag must cover that status too.

Hard-won lessons from the code review of this story:

- All three layers of an isolated adversarial review found the BullMQ job-id collision independently: a diff-only reviewer with zero project context, one with project read access, and one checking this story's acceptance criteria.
  When independently blinded reviewers converge on the same finding without seeing each other's output, treat it as ground truth and reproduce it before touching anything.
- A commit-vs-replay status-code fix (`201` fresh, `200` idempotent replay, matching the existing `createMyFormUploadUrl`/`commitGarment` convention) shipped with _no test that exercised the real wire response_.
  The unit test asserted a spy on a hand-built mock `res` object that did not model Express's or Nest's real status-setting behavior.
  The integration test called the service directly and skipped the controller.
  Both stayed green when the controller was mutated back to an unconditional `201`.
  A fix to HTTP-visible behavior needs one assertion that goes over HTTP (a real Nest `TestingModule` + `supertest`), on top of the unit test of the function that computes the status.
- Cleanup that drains a real, shared external queue (Redis-backed BullMQ) must run even when the test's own assertions throw.
  Otherwise one real failure manufactures a second, unrelated-looking failure in whichever sibling test's `Worker` runs next and picks up the leaked job.
  The fix is `vitest`'s `onTestFinished(...)`, registered _before_ any assertion.
  A `beforeAll` that also clears the queue at suite start catches the case where the run that leaked the job ended before the next run started.
- Squash-merging a stacked branch's base breaks git ancestry for every sibling branch that shared that history.
  A plain `git merge` or `git rebase` against the new squashed history then produces one add/add conflict per file both sides touched, even for files whose content barely changed.
  Cherry-picking only the sibling branch's own commits onto the fresh base avoids this.
  A 3-way diff against the commit's real parent applies cleanly far more often than a whole-branch merge against unrelated history.

Story/Task mapping:

- Story 4.4
- Task 1 (Prisma schema, migration, RLS)
- Task 2 (Wardrobe contracts, fixtures, factories)
- Task 3 (Onboarding-state and silhouette API)
- Task 4 (My Form processing pipeline)
- Task 5 (Web onboarding and silhouette experience)
- Task 6 (Mobile onboarding and silhouette experience)
- Task 7 (Consumer and provider contracts)
- Task 8 (End-to-end and accessibility automation)
- Task 9 (Verification gate)

Story reference:

- `_bmad-output/implementation-artifacts/4-4-wardrobe-onboarding-silhouette-setup.md`
- `_bmad-output/test-artifacts/test-reviews/wardrobe-onboarding-silhouette-pact-test-review-2026-08-10.md`

Cross-links:

- Step 3 provides Prisma schema modeling and migration conventions.
- Step 4 provides Supabase environment isolation and guardian-aware RLS helpers.
- Step 5 provides the BullMQ queue/worker conventions this story's moderation pipeline reuses, and whose job-id assumptions it stress-tested.
- Step 18 provides the durable-telemetry pattern the onboarding guard columns extend.
- Step 22 provides the localization pipeline and parity-test pattern.
- Step 28 provides the accessibility baseline the guided-flow screens build on.
- Step 29 provides the garment capture flow this story's onboarding checklist reuses.
- Step 30 provides smart tagging, which gates onboarding's capture-to-silhouette transition.
- Step 31 provides the ETag/`If-Match` concurrency pattern this story's onboarding and silhouette resources both follow.

Sequence to follow:

1. `packages/db/prisma/schema.prisma` and `packages/db/prisma/migrations/20260809090000_add_wardrobe_onboarding_silhouette/migration.sql` for the `WardrobeOnboardingState`/`SilhouetteProfile` models, the five new enums, and the telemetry-guard columns added in a follow-up migration.
2. `packages/api-client/src/contracts/http/wardrobe.ts` for the onboarding and silhouette Zod contracts, including the commit route's `201` fresh/`200` replay pair.
3. `apps/api/src/modules/wardrobe/wardrobe-onboarding.service.ts` for the advisory-lock create-or-advance transaction and server-authoritative garment counting, then `wardrobe-onboarding.controller.ts` for the HTTP surface.
4. `apps/api/src/modules/wardrobe/wardrobe-silhouette.service.ts` for slider persistence and the My Form upload/commit/delete lifecycle, then `wardrobe-silhouette.controller.ts`.
5. `apps/api/src/modules/wardrobe/heuristic-silhouette-photo-moderation.engine.ts` for the border-contrast and bare-skin heuristics and the Sharp `.stats()`-after-`.extract()` workaround, then `silhouette-photo-processing.queue.ts` and `silhouette-photo.processor.ts` for the BullMQ producer/consumer pair.
6. `apps/web/src/app/wardrobe/onboarding/page.tsx` and `apps/mobile/src/features/wardrobe/wardrobe-onboarding-screen.tsx` for the two guided-flow surfaces; `silhouette-settings-panel.tsx` (web) and `silhouette-editor.tsx` (mobile) for the shared slider/My Form editor that both the onboarding step and the standalone settings screen reuse.
7. `pact/http/consumer/api-contract-interactions.ts` and `pact/http/provider/provider-helper.ts` for the consumer/provider contract proof, once Task 3/4's real controllers exist to verify against.
8. Tests, in order of what they prove:
   - `apps/api/integration/wardrobe-onboarding.integration.spec.ts` and `wardrobe-silhouette.integration.spec.ts` (real PostgreSQL: advisory-lock serialization, revision races; real Redis: the one real-`Worker` end-to-end BullMQ test in this repo before this story)
   - `apps/api/src/modules/wardrobe/wardrobe-silhouette.controller.spec.ts` plus a `supertest` round trip for the commit route's real wire status code
   - `apps/web/src/i18n/wardrobe-onboarding-silhouette-locales.spec.ts` and the mobile twin

Task owner map:

- Story 4.4 Task 1 step 1 owner: define WardrobeOnboardingState and SilhouetteProfile models, enums, and RLS policies in packages/db/prisma/schema.prisma
- Story 4.4 Task 2 step 1 owner: define onboarding-state and silhouette HTTP contracts and Zod schemas in packages/api-client/src/contracts/http/wardrobe.ts
- Story 4.4 Task 3 step 1 owner: implement the advisory-lock onboarding state machine in apps/api/src/modules/wardrobe/wardrobe-onboarding.service.ts
- Story 4.4 Task 3 step 2 owner: expose WardrobeOnboardingController REST endpoints in apps/api/src/modules/wardrobe/wardrobe-onboarding.controller.ts
- Story 4.4 Task 3 step 3 owner: implement silhouette slider persistence and My Form lifecycle in apps/api/src/modules/wardrobe/wardrobe-silhouette.service.ts
- Story 4.4 Task 3 step 4 owner: expose WardrobeSilhouetteController REST endpoints in apps/api/src/modules/wardrobe/wardrobe-silhouette.controller.ts
- Story 4.4 Task 4 step 1 owner: implement the heuristic silhouette photo moderation engine in apps/api/src/modules/wardrobe/heuristic-silhouette-photo-moderation.engine.ts
- Story 4.4 Task 4 step 2 owner: implement the BullMQ producer with per-attempt job ids in apps/api/src/modules/wardrobe/silhouette-photo-processing.queue.ts
- Story 4.4 Task 4 step 3 owner: implement the moderation-review worker consumer in apps/api/src/modules/wardrobe/silhouette-photo.processor.ts
- Story 4.4 Task 5 step 1 owner: implement the web guided onboarding screen in apps/web/src/app/wardrobe/onboarding/page.tsx
- Story 4.4 Task 5 step 2 owner: implement the shared web silhouette settings panel in apps/web/src/app/components/silhouette-settings-panel.tsx
- Story 4.4 Task 6 step 1 owner: implement the mobile guided onboarding screen in apps/mobile/src/features/wardrobe/wardrobe-onboarding-screen.tsx
- Story 4.4 Task 6 step 2 owner: implement the shared mobile silhouette editor in apps/mobile/components/wardrobe/silhouette-editor.tsx
- Story 4.4 Task 7 step 1 owner: wire real provider verification for onboarding and silhouette in pact/http/provider/provider-helper.ts
- Story 4.4 Task 8 step 1 owner: real-PostgreSQL and real-Redis integration coverage in apps/api/integration/wardrobe-silhouette.integration.spec.ts

Tests that cover this step:

Real-PostgreSQL database tests:

- [`packages/db/test/wardrobe-onboarding-schema.spec.ts`](../../packages/db/test/wardrobe-onboarding-schema.spec.ts): proves onboarding and silhouette defaults, singleton and upload uniqueness, cascades, moderation linkage, indexes, row-level security, and grants against PostgreSQL.
- [`packages/db/test/rls/onboarding-silhouette.spec.ts`](../../packages/db/test/rls/onboarding-silhouette.spec.ts): proves owner, guardian, admin, stranger, spoofing, and service-role boundaries for onboarding and silhouette rows.

Shared contract unit tests:

- [`packages/utils/src/wardrobe-object-path.spec.ts`](../../packages/utils/src/wardrobe-object-path.spec.ts): proves My Form object paths stay inside the expected user and silhouette-profile namespace.
- [`packages/api-client/testing/wardrobe-onboarding-contract.spec.ts`](../../packages/api-client/testing/wardrobe-onboarding-contract.spec.ts): proves valid state-machine shapes, impossible-state rejection, transition input, response envelopes, OpenAPI routes, and precondition errors.
- [`packages/api-client/testing/wardrobe-silhouette-contract.spec.ts`](../../packages/api-client/testing/wardrobe-silhouette-contract.spec.ts): proves slider, My Form lifecycle, upload declaration, commit, failure reason, binary route, ETag, and error schemas.
- [`packages/api-client/testing/wardrobe-onboarding-analytics.spec.ts`](../../packages/api-client/testing/wardrobe-onboarding-analytics.spec.ts): proves onboarding analytics accept canonical properties and reject photo, body-detail, and non-allowlisted fields.

API unit and boundary tests:

- [`apps/api/src/modules/wardrobe/wardrobe-onboarding.controller.spec.ts`](../../apps/api/src/modules/wardrobe/wardrobe-onboarding.controller.spec.ts): proves GET and PATCH validation, `If-Match` forwarding, response envelopes, and ETag headers.
- [`apps/api/src/modules/wardrobe/wardrobe-onboarding.service.spec.ts`](../../apps/api/src/modules/wardrobe/wardrobe-onboarding.service.spec.ts): proves strong ETags, forward-only transitions, server-authoritative garment counts, sticky starter choice, revision races, no-op replay, and recoverable exactly-once telemetry.
- [`apps/api/src/modules/wardrobe/wardrobe-silhouette.controller.spec.ts`](../../apps/api/src/modules/wardrobe/wardrobe-silhouette.controller.spec.ts): proves slider, upload allocation, raw-byte relay, commit, delete, request validation, ETags, and real fresh-versus-replay wire statuses.
- [`apps/api/src/modules/wardrobe/wardrobe-silhouette.service.spec.ts`](../../apps/api/src/modules/wardrobe/wardrobe-silhouette.service.spec.ts): proves slider persistence, optimistic revisions, My Form allocation/upload/commit/delete, guardian consent, validation, idempotency, queue recovery, and signed ready-image access.
- [`apps/api/src/modules/wardrobe/wardrobe-silhouette-image-validation.spec.ts`](../../apps/api/src/modules/wardrobe/wardrobe-silhouette-image-validation.spec.ts): proves decodable portrait framing and rejects declaration or geometry mismatches.
- [`apps/api/src/modules/wardrobe/wardrobe-upload-token.spec.ts`](../../apps/api/src/modules/wardrobe/wardrobe-upload-token.spec.ts): proves the shared HMAC token handles My Form session payloads, multibyte subjects, tampering, expiry, and weak secrets.
- [`apps/api/src/modules/wardrobe/silhouette-photo-moderation.engine.spec.ts`](../../apps/api/src/modules/wardrobe/silhouette-photo-moderation.engine.spec.ts): proves contrast and privacy verdict heuristics plus test-fixture engine environment guards.
- [`apps/api/src/modules/wardrobe/silhouette-photo-processing.queue.spec.ts`](../../apps/api/src/modules/wardrobe/silhouette-photo-processing.queue.spec.ts): proves unique, stable, BullMQ-safe per-attempt job-id derivation and job-payload validation.
- [`apps/api/src/modules/wardrobe/silhouette-photo.processor.spec.ts`](../../apps/api/src/modules/wardrobe/silhouette-photo.processor.spec.ts): proves ready, contrast, privacy, guardian-notification, stale-job, and storage-failure processing paths.
- [`apps/api/src/workers/wardrobe.bootstrap.spec.ts`](../../apps/api/src/workers/wardrobe.bootstrap.spec.ts): proves the worker source registers one moderation-review consumer and selects the configured moderation engine with stable failure classification.

Real-infrastructure integration tests:

- [`apps/api/integration/wardrobe-onboarding.integration.spec.ts`](../../apps/api/integration/wardrobe-onboarding.integration.spec.ts): proves the virtual default, full and starter paths, advisory-lock concurrency, revision conflicts, forward-only state, sticky choices, and telemetry recovery against PostgreSQL.
- [`apps/api/integration/wardrobe-silhouette.integration.spec.ts`](../../apps/api/integration/wardrobe-silhouette.integration.spec.ts): proves slider serialization, guardian denial, the real PostgreSQL and Redis/BullMQ My Form pipeline, per-attempt jobs, deletion, and idempotent commit behavior.

Web unit, component, and localization tests:

- [`apps/web/src/lib/wardrobe.test.ts`](../../apps/web/src/lib/wardrobe.test.ts): proves onboarding and silhouette client wrappers preserve schemas, ETags, idempotency keys, raw uploads, statuses, and abort signals.
- [`apps/web/src/app/components/silhouette-settings-panel.test.tsx`](../../apps/web/src/app/components/silhouette-settings-panel.test.tsx): proves slider saves, My Form guidance, upload and processing, deletion, conflicts, retries, accessibility, and stale-result suppression.
- [`apps/web/src/app/wardrobe/onboarding/page.test.tsx`](../../apps/web/src/app/wardrobe/onboarding/page.test.tsx): proves permission, capture, tagging, starter, silhouette, completion, resume, polling, focus, announcements, concurrency guards, and error states.
- [`apps/web/src/app/wardrobe/onboarding/page.bootstrap-failures.test.tsx`](../../apps/web/src/app/wardrobe/onboarding/page.bootstrap-failures.test.tsx): proves bootstrap and transition failures render useful copy and late results are ignored after unmount.
- [`apps/web/src/app/wardrobe/onboarding/page.remaining-paths.test.tsx`](../../apps/web/src/app/wardrobe/onboarding/page.remaining-paths.test.tsx): proves rejected camera permission and the remaining tagging-to-silhouette branch.
- [`apps/web/src/app/wardrobe/page.test.tsx`](../../apps/web/src/app/wardrobe/page.test.tsx): proves the wardrobe hub exposes onboarding and standalone silhouette entry points with the correct current state.
- [`apps/web/src/i18n/wardrobe-onboarding-locales.spec.ts`](../../apps/web/src/i18n/wardrobe-onboarding-locales.spec.ts): proves all supported Web catalogs have complete, meaningful onboarding and silhouette copy.

Mobile unit, component, and localization tests:

- [`apps/mobile/src/lib/wardrobe.test.ts`](../../apps/mobile/src/lib/wardrobe.test.ts): proves onboarding and silhouette request wrappers, ETags, upload sessions, commit statuses, and error normalization.
- [`apps/mobile/components/wardrobe/garment-capture-modal.test.tsx`](../../apps/mobile/components/wardrobe/garment-capture-modal.test.tsx): proves the reusable native capture modal reports committed garments back to onboarding and handles consent, progress, retry, and accessibility.
- [`apps/mobile/components/wardrobe/silhouette-editor.test.tsx`](../../apps/mobile/components/wardrobe/silhouette-editor.test.tsx): proves slider boundaries and saves, My Form guidance, upload, processing, retries, deletion, announcements, and stale-response handling.
- [`apps/mobile/src/features/wardrobe/wardrobe-onboarding-screen.test.tsx`](../../apps/mobile/src/features/wardrobe/wardrobe-onboarding-screen.test.tsx): proves permission, capture, tagging, starter, silhouette, completion, resume, polling, consent, offline, and stale-revision paths.
- [`apps/mobile/src/features/wardrobe/wardrobe-silhouette-screen.test.tsx`](../../apps/mobile/src/features/wardrobe/wardrobe-silhouette-screen.test.tsx): proves the standalone screen resolves authentication and exposes the shared editor or sign-in state.
- [`apps/mobile/src/features/wardrobe/wardrobe-hub-screen.test.tsx`](../../apps/mobile/src/features/wardrobe/wardrobe-hub-screen.test.tsx): proves the hub reflects onboarding progress and routes to onboarding or My Form settings.
- [`apps/mobile/src/i18n/wardrobe-onboarding-silhouette-locales.spec.ts`](../../apps/mobile/src/i18n/wardrobe-onboarding-silhouette-locales.spec.ts): proves all supported Mobile catalogs have complete, meaningful onboarding and silhouette copy.

Pact contract tests:

- [`pact/http/consumer/mobile-api-client.pacttest.ts`](../../pact/http/consumer/mobile-api-client.pacttest.ts): defines Mobile's expected onboarding, slider, My Form upload, commit, replay, and deletion interactions against the Pact mock server.
- [`pact/http/consumer/web-api-client.pacttest.ts`](../../pact/http/consumer/web-api-client.pacttest.ts): defines Web's expected onboarding, slider, My Form upload, commit, replay, and deletion interactions against the Pact mock server.
- [`pact/http/provider/api-provider.pacttest.ts`](../../pact/http/provider/api-provider.pacttest.ts): replays generated onboarding and silhouette interactions against real Nest controllers with scenario-controlled service doubles.

Playwright end-to-end tests:

- [`playwright/tests/wardrobe-onboarding-flow.spec.ts`](../../playwright/tests/wardrobe-onboarding-flow.spec.ts): proves the guided permission, capture, tagging, silhouette-slider, completion, redirect, and persisted-resume journey.
- [`playwright/tests/wardrobe-onboarding-my-form.spec.ts`](../../playwright/tests/wardrobe-onboarding-my-form.spec.ts): proves My Form upload through ready, slider fallback to the mannequin, contrast-failure recovery, and transient-network retry.
- [`playwright/tests/wardrobe-onboarding-accessibility.spec.ts`](../../playwright/tests/wardrobe-onboarding-accessibility.spec.ts): proves keyboard navigation, focus movement and restoration, announcements, target sizes, and Axe results for onboarding and silhouette surfaces.

Mobile end-to-end tests:

- [`maestro/wardrobe-onboarding-flow.yaml`](../../maestro/wardrobe-onboarding-flow.yaml): exercises the native guided onboarding path through completion.
- [`maestro/wardrobe-onboarding-my-form-flow.yaml`](../../maestro/wardrobe-onboarding-my-form-flow.yaml): exercises native My Form guidance, upload, ready result, removal, and mannequin fallback.
- [`maestro/wardrobe-onboarding-localization-flow.yaml`](../../maestro/wardrobe-onboarding-localization-flow.yaml): exercises localized onboarding and silhouette labels in a built app.

Architecture diagram:

```mermaid
flowchart TD
  Client["Web / Mobile\n(onboarding screen + silhouette settings panel/editor)"] --> OC["WardrobeOnboardingController\n(If-Match, forward-only targetStep)"]
  Client --> SC["WardrobeSilhouetteController\n(sliders, My Form upload/commit/delete)"]
  OC --> OS["WardrobeOnboardingService\n(pg_advisory_xact_lock, server-authoritative garment count)"]
  SC --> SS["WardrobeSilhouetteService\n(advisory lock, upload-token HMAC, revision)"]
  OS --> DB[("PostgreSQL\nWardrobeOnboardingState, telemetry guard columns")]
  SS --> DB2[("PostgreSQL\nSilhouetteProfile, my_form_* lifecycle fields")]
  SS -- "commitMyForm" --> Queue["SilhouettePhotoProcessingQueue\n(jobId: profileId + uploadSessionId)"]
  Queue --> Worker["moderation-review Worker\n(SilhouettePhotoProcessor, exactly-one consumer)"]
  Worker --> Engine["HeuristicSilhouettePhotoModerationEngine\n(border contrast, bare-skin ratio)"]
  Worker --> DB2
  Worker -- "on flag, teen actor" --> Guardian["Guardian outbox notification"]
  OS -- "started/completed" --> Telemetry["Guarded telemetry emission\n(started_telemetry_emitted_at / completed_telemetry_emitted_at)"]
```

## Step 33: Affiliate "Shop this look" CTA

User/business impact:

Turns an outfit card into qualified traffic for a brand partner.
An eligible card carries a disclosed "Shop this look" control naming the partner.
Tapping it mints one attributed click and hands off to an in-app browser, and the partner reports the resulting purchase back over a signed webhook.
One settings toggle on Mobile and Web hides every affiliate suggestion.
The server enforces it, so it takes effect on the next request, even while a cached recommendation is live.
This is the product's first revenue surface, so it ships with three guardrails.
Disclosure renders before the control in reading order.
Click and conversion records are durable commercial facts retained for two years.
No URL, product title, garment id, or raw user id ever reaches an analytics property.

Key takeaways:

1. **Commerce is assembled after personalization.**
   `RitualService` owns the cacheable outfit recommendation.
   `RitualController` adds `shopThisLook` after every cold or warm service path has returned.
   This keeps catalog and preference state out of Redis and gives every response one eligibility checkpoint.
2. **Opt-out is enforced on the server and protected on the device.**
   The preferences API is always reachable, including when the affiliate feature flag is disabled.
   Mobile removes `shopThisLook` before saving its device cache, so cached and offline recommendations cannot revive a hidden CTA.
3. **Attribution begins with a durable click.**
   The Ritual response carries no partner URL.
   A click request rechecks eligibility, inserts or reuses one `AffiliateClick`, mints an opaque HMAC token, validates the destination host, and only then returns the redirect URL.
4. **Product dedupe and concurrency dedupe are separate rules.**
   The service enforces a rolling 60-second window.
   A partial unique index over the click's minute bucket decides simultaneous insert races.
   The service still handles taps that straddle adjacent minute buckets.
5. **Webhook verification starts with the exact request bytes.**
   The public conversion route authenticates with a timestamped HMAC over `rawBody`.
   Its partner record can reference only an allowlisted environment variable name, and the database never stores the secret value.
6. **Commercial facts outlive analytics.**
   Clicks and conversions stay in append-only commercial storage for 24 months.
   Telemetry gets strict, privacy-safe properties; redirect URLs, product titles, garment ids, and raw user ids stay out of it.
7. **Commerce data is owner-only.**
   Guardians cannot read a user's preference or purchase-intent trail.
   Catalog and conversion tables are server-only, and negative RLS tests prove that the expected grants existed before revocation.
8. **Offer selection is deterministic.**
   The lookup checks partner activity, publication windows in a single UTC frame, exact locale before the `'*'` fallback, priority, and id as the final tie-breaker.
   Tests isolate themselves from the shared seed data with test-owned garment categories, which leaves the seed in place while parallel suites run.

Hard-won lessons from the implementation and code review of this story:

1. **A green test suite does not mean the code compiles.**
   Making `shopThisLook` a required field on `scenarioOutfitSchema` broke `RitualService`, whose declared return type stopped matching.
   All 1271 API tests still passed, because Vitest transpiles through esbuild without type checking, and lint says nothing about assignability.
   `npm run typecheck` is a separate gate and belongs next to the test run for any change that touches a shared contract type.
   This break shipped to a branch that four other sessions then built on.

2. **`timestamp without time zone` compared against `now()` silently shifts by the session time zone.**
   Prisma writes `DateTime` columns as UTC instants into `timestamp(3)`, which carries no zone.
   PostgreSQL's `now()` returns `timestamptz`.
   Comparing the two makes PostgreSQL read the naive side in the session's `TimeZone`, so on a container set to `America/Chicago` every affiliate publication window moved five hours and the sixty-second click dedupe window could not match at all.
   The correct comparison is `now() AT TIME ZONE 'UTC'`, which yields a naive timestamp whose wall-clock reading is the UTC instant, the same frame the column was written in.
   A pair of boundary tests exposed it by failing roughly half the time, depending on whether `now()`'s sub-millisecond remainder rounded up on write.
   A test that flakes at a boundary is often reporting a real frame mismatch.

3. **Parallel branches can each fix the same break correctly and merge into a defect.**
   Two sessions independently repaired the compile error above.
   One widened the service's return type to exclude the commerce field; the other wrote `shopThisLook: null` in the service.
   Git auto-merged both without a conflict, because they touched different lines.
   The combination compiles and is wrong: writing the key inside the service puts it into the Redis payload and the persisted `OutfitRecommendation` rows, which is the cache poisoning the assembly-point design exists to prevent.
   When branches run in parallel, read the result of any clean merge of a shared file.

4. **A wildcard sentinel is only a wildcard if the query says so.**
   The offer catalog publishes globally with `locale_region = '*'`, and the seed exists so the feature is demonstrable end to end.
   The first implementation compared `locale_region` for exact equality, so every seeded row matched nothing, because a real user always resolves to a country subtag.
   The feature looked correct in unit tests, which asserted the SQL text, and would have failed the first end-to-end run.
   A sentinel value needs a test from both directions: a global row reaching a regional request, and a request with no resolvable region reaching a global row.

5. **A shared seed and an integration test that asserts emptiness cannot both be right.**
   Once the sentinel worked, the seeded global catalog matched every query, and eight offer-selection tests that asserted "no offer was selected" started failing for a correct reason.
   On a database that carries a globally published catalog, a test cannot assert emptiness.
   Temporarily parking the shared rows also fails under parallel execution, because it races any suite creating new offers.
   The stable fix isolates each test with a test-owned garment category and leaves the shared catalog intact for Playwright, Maestro, and other integration suites.

6. **Reading `process.env[<value from a database row>]` is an unbounded environment read.**
   Each affiliate partner names its own webhook signing secret through `CommercePartner.webhook_secret_ref`.
   Left unconstrained, whoever can write a catalog row can read any variable in the process, including `DATABASE_URL` and the Supabase service-role key.
   Two bounds apply on purpose: a database check constraint pinning the name to `^COMMERCE_PARTNER_[A-Z0-9_]{1,40}_WEBHOOK_SECRET$`, and a runtime guard that re-checks the same pattern before the lookup.
   The database stores only the variable name.

7. **`NestFactory.create` is called in three places, and the deployed one is `apps/api/api/index.ts`.**
   `apps/api/vercel.json` maps the function to `apps/api/api/index.ts` and rewrites every path to it, so preview and production skip the `src/main.ts` bootstrap that local development runs.
   Signature verification needs `rawBody: true` in all three, including each test's own `moduleFixture.createNestApplication(...)`; otherwise the proof test passes against a `rawBody === undefined` path for the wrong reason.
   Auditing that difference surfaced a larger, older problem: the deployed bootstrap installs no `ApiExceptionFilter`, so `api_error_occurred` telemetry has never been emitted outside local development, on any route, since Step 4.
   Dashboards built on that event have been showing local traffic only.

8. **Put the request-scoped decision after the cache.**
   `RitualService` returns its cached payload hundreds of lines before response assembly and has no single post-cache point, so the commerce block is assembled in `RitualController` between the service call and the schema parse.
   Every path, cold generate and both warm-cache reads, passes through that line, which is what makes the opt-out take effect immediately while a cached recommendation is still being served.
   The rejected alternative, a commerce revision in the cache key, multiplies entries by preference state and makes one catalog edit evict every user's personalization cache.
   The client cache needed the same treatment: the block is stripped before `saveRitualCache`.
   A device cache is served for fifteen minutes online and indefinitely offline, so a cached block would read as a broken opt-out.

9. **The concurrency index and the product's dedupe window are two different rules.**
   Click dedupe is a sixty-second sliding window, enforced by a read-then-insert that two simultaneous taps both pass.
   The backstop is a unique index on `(user_id, offer_id, recommendation_id, date_trunc('minute', created_at))`, which guarantees exactly one row survives a race.
   Two taps at 10:00:59 and 10:01:01 fall in different buckets and both insert; the service's own window check catches those.
   The suite asserts both facts, so the gap between them stays visible.

10. **Owner-only is a deliberate exception in a guardian-shared schema.**
    Every other wardrobe-adjacent table here is readable by a consenting guardian.
    `CommercePreference` and `AffiliateClick` are not, because this story has no mandate to expose a purchase-intent trail.
    Readers assume the opposite by default, so the actor matrix asserts that both consent levels are denied.

11. **A negative assertion that cannot fail hides a broken control.**
    The commerce migration revokes the client roles' access to the three catalog tables, and the RLS suite asserts they cannot reach them.
    Adding an ephemeral `postgres:16-alpine` to CI so those suites could run at all quietly made those assertions vacuous.
    Stock PostgreSQL grants client roles nothing by default, so on that container the REVOKEs had nothing to revoke and became no-ops.
    Deleting all three from the migration left the suite 49/49 green.
    The same blindness covered the matching negative assertions in Steps 31 and 32, so three stories carried a control that could not fail.
    The fix gives the container Supabase's default-privilege behaviour, scoped by measurement in both directions: `GRANT ALL` reintroduces the `REFERENCES`/`TRIGGER`/`TRUNCATE` artefact and fails 8 tests, and including `anon` breaks the zero-grant requirement and fails 6.
    A negative assertion needs its own mutation test.
    Coverage reports an untested control as untested; nothing reports an unfalsifiable one, because it looks green forever.

12. **Two free-tier limits pulled this work in opposite directions.**
    CodeRabbit declined to review the implementation pull request because its 142 files exceed the 100-file cap, which argues for smaller pull requests.
    The pushes from splitting across four branches hit Vercel's build rate limit, which argues for fewer.
    Neither constraint shows up when planning; both surface only at integration time, and one shape cannot satisfy both.
    Decide up front which one a given story is more willing to pay.

13. **`done` must keep its evidence boundaries visible.**
    The automated API, database, contract, Playwright, and k6 evidence is recorded.
    The Maestro flow has not completed end to end, VoiceOver and TalkBack were not observed, the nine non-English disclosure translations still need human review, and Pact provider verification retains a pre-existing intermittent Linux failure.
    Story completion records those limits as open.

Story/Task mapping:

- Story 5.1
- Task 1 (Prisma schema, migration, RLS, and reachable seed)
- Task 2 (Contracts, analytics registries, fixtures, and factories)
- Task 3 (Commerce module, preferences, eligibility, and retention)
- Task 4 (Attributed click endpoint)
- Task 5 (Conversion webhook)
- Task 6 (Mobile CTA and settings)
- Task 7 (Web settings surface)
- Task 8 (Consumer and provider contracts)
- Task 9 (End-to-end, accessibility, and performance evidence)
- Task 10 (Verification gate)

Story reference:

- `_bmad-output/implementation-artifacts/5-1-affiliate-shop-this-look-cta.md`
- `_bmad-output/implementation-artifacts/5-1-review-log.md`
- `_bmad-output/test-artifacts/story-5.1-release-qa.md`

Cross-links:

- Step 3 provides the Prisma modeling, migration, deterministic seed, and RLS foundation for the five commerce models.
- Step 7 provides the quality gates that must include type checking alongside lint and tests.
- Step 8 provides the shared analytics contracts and privacy allowlists.
- Step 15 provides the canonical contract validation and generated-client flow.
- Step 18 provides the audit and durable telemetry conventions.
- Step 19 provides the cached Ritual recommendation that commerce decorates at the controller boundary.
- Step 22 provides localization parity across ten Web and Mobile catalogs.
- Step 28 provides the keyboard, focus, and assistive-technology baseline.
- Step 32 provides the negative-test and real-infrastructure review discipline carried into this story.

Sequence to follow:

1. Read `packages/db/prisma/schema.prisma`, `packages/db/prisma/migrations/20260811090000_add_commerce_affiliate/migration.sql`, and `packages/db/prisma/seeds/commerce.ts` for the commercial record model, constraints, policies, indexes, and globally reachable seed.
2. Read `packages/api-client/src/contracts/http/commerce.ts`, `packages/api-client/src/contracts/http/ritual.ts`, and `packages/api-client/src/contracts/http/openapi.ts` for the public schemas, nullable response decoration, status codes, and generated API boundary.
3. Read `apps/api/src/modules/commerce/affiliate-offer.service.ts` for ordered eligibility and offer selection, then `commerce-preferences.service.ts` and `commerce-retention.service.ts` for opt-out, audit, and 24-month retention.
4. Read `apps/api/src/modules/personalization/ritual.controller.ts` for the post-cache assembly point.
   Then inspect `apps/mobile/src/lib/ritual-cache.ts` and `apps/mobile/app/(tabs)/index.tsx` for device-cache stripping.
5. Read `apps/api/src/modules/commerce/affiliate-click.service.ts`, `commerce-click-token.ts`, and `affiliate-deep-link.ts` for dedupe, opaque attribution, and redirect validation.
6. Read `apps/api/src/modules/commerce/affiliate-webhook-signature.ts` and `affiliate-webhook.service.ts`, then compare `apps/api/src/main.ts` with `apps/api/api/index.ts` to see why raw-body configuration belongs in every bootstrap.
7. Read `apps/mobile/components/hero/outfit-recommendation-card.tsx`, `apps/mobile/app/(tabs)/settings.tsx`, and `apps/web/src/app/components/commerce-preferences-section.tsx` for disclosure, browser handoff, accessibility, and immediate preference updates.
8. Read the evidence in this order: `apps/api/integration/commerce-affiliate-offers.integration.spec.ts`, `commerce-affiliate-clicks.integration.spec.ts`, `commerce-affiliate-webhook.integration.spec.ts`, `packages/db/test/commerce-schema.spec.ts`, `playwright/tests/api/commerce-affiliate.api.spec.ts`, and `_bmad-output/test-artifacts/story-5.1-release-qa.md`.

Task owner map:

- Story 5.1 Task 1 step 1 owner: define commerce models, constraints, indexes, and RLS policies in `packages/db/prisma/schema.prisma` and its migration.
- Story 5.1 Task 1 step 2 owner: seed the partner, global offer, and feature flag in `packages/db/prisma/seeds/commerce.ts` and `feature-flags.ts`.
- Story 5.1 Task 2 step 1 owner: define commerce HTTP and Ritual response contracts in `packages/api-client/src/contracts/http/commerce.ts` and `ritual.ts`.
- Story 5.1 Task 2 step 2 owner: register privacy-safe commerce analytics in `packages/api-client/src/types/analytics-events.ts`.
- Story 5.1 Task 3 step 1 owner: resolve eligible offers in `apps/api/src/modules/commerce/affiliate-offer.service.ts`.
- Story 5.1 Task 3 step 2 owner: persist preference changes and audit rows in `apps/api/src/modules/commerce/commerce-preferences.service.ts`.
- Story 5.1 Task 3 step 3 owner: assemble `shopThisLook` after the cached service result in `apps/api/src/modules/personalization/ritual.controller.ts`.
- Story 5.1 Task 4 step 1 owner: deduplicate clicks and mint attribution in `apps/api/src/modules/commerce/affiliate-click.service.ts`.
- Story 5.1 Task 5 step 1 owner: verify signatures and persist conversions in `apps/api/src/modules/commerce/affiliate-webhook.service.ts`.
- Story 5.1 Task 6 step 1 owner: render the disclosed Mobile CTA in `apps/mobile/components/hero/outfit-recommendation-card.tsx`.
- Story 5.1 Task 6 step 2 owner: strip commerce before device caching in `apps/mobile/app/(tabs)/index.tsx`.
- Story 5.1 Tasks 6 and 7 step 1 owner: implement Mobile and Web preference controls in their settings surfaces.
- Story 5.1 Task 8 step 1 owner: prove consumer and provider compatibility in `pact/http/consumer/` and `pact/http/provider/`.
- Story 5.1 Tasks 9 and 10 step 1 owner: record E2E, accessibility, query-plan, performance, and verification evidence in the test suites and release QA artifact.

Tests that cover this step:

Each file below starts with a Step 33 cross-link.
Open the test before the implementation when you want to learn the behavior from executable examples.
The map describes what each test asserts.
Execution evidence and known gaps remain authoritative in `_bmad-output/test-artifacts/story-5.1-release-qa.md`.

Configuration and fixture unit tests:

- [`packages/config/src/flags.spec.ts`](../../packages/config/src/flags.spec.ts): proves the affiliate kill switch is registered and defaults to off when remote and stored values are unavailable.
- [`packages/testing/test/commerce.factory.spec.ts`](../../packages/testing/test/commerce.factory.spec.ts): proves constraint-safe fixture defaults, Prisma mappings, relationship wiring, and cleanup registration.
- [`packages/testing/test/cleanup.spec.ts`](../../packages/testing/test/cleanup.spec.ts): proves tracked user cleanup reaches preference and click delegates in the expected dependency order and clears the registry afterward.

Real-PostgreSQL database tests:

- [`packages/db/test/commerce-schema.spec.ts`](../../packages/db/test/commerce-schema.spec.ts): proves defaults, constraints, uniqueness, cascades, indexes, RLS enablement, and client grants.
- [`packages/db/test/commerce-seed.spec.ts`](../../packages/db/test/commerce-seed.spec.ts): proves the non-production seed creates active wildcard offers for four slots and never stores a real secret.
- [`packages/db/test/rls/commerce.spec.ts`](../../packages/db/test/rls/commerce.spec.ts): proves owner access, guardian denial, admin access, spoofing resistance, and server-only catalog/conversion tables.

Shared contract and analytics tests:

- [`packages/api-client/testing/commerce-contract.spec.ts`](../../packages/api-client/testing/commerce-contract.spec.ts): proves the `shopThisLook`, preference, click, webhook, status, and error-envelope schemas.
- [`packages/api-client/testing/commerce-analytics.spec.ts`](../../packages/api-client/testing/commerce-analytics.spec.ts): proves canonical event builders and rejects URLs, titles, garment ids, and raw user ids.
- [`packages/api-client/testing/ritual-contract.spec.ts`](../../packages/api-client/testing/ritual-contract.spec.ts): proves the existing Ritual collection rules still accept outfits carrying `shopThisLook: null`.

API unit and boundary tests:

- [`apps/api/src/filters/api-exception.filter.spec.ts`](../../apps/api/src/filters/api-exception.filter.spec.ts): proves webhook rejections are excluded from generic API-error telemetry while neighboring routes remain observable.
- [`apps/api/src/modules/commerce/affiliate-click.controller.spec.ts`](../../apps/api/src/modules/commerce/affiliate-click.controller.spec.ts): proves authentication, locale forwarding, exception-to-status mapping, and `201` versus `200`.
- [`apps/api/src/modules/commerce/affiliate-click.service.spec.ts`](../../apps/api/src/modules/commerce/affiliate-click.service.spec.ts): proves click eligibility precedence, recent-click replay behavior, race recovery, token minting, and telemetry.
- [`apps/api/src/modules/commerce/affiliate-click.telemetry.spec.ts`](../../apps/api/src/modules/commerce/affiliate-click.telemetry.spec.ts): proves click analytics uses the pseudonymous subject and privacy-safe properties.
- [`apps/api/src/modules/commerce/affiliate-deep-link.spec.ts`](../../apps/api/src/modules/commerce/affiliate-deep-link.spec.ts): proves template substitution and the outbound host allowlist.
- [`apps/api/src/modules/commerce/affiliate-offer.service.spec.ts`](../../apps/api/src/modules/commerce/affiliate-offer.service.spec.ts): proves every eligibility short-circuit, slot derivation, and locale fallback.
- [`apps/api/src/modules/commerce/affiliate-webhook-signature.spec.ts`](../../apps/api/src/modules/commerce/affiliate-webhook-signature.spec.ts): proves raw-byte HMAC verification and constant-time signature handling.
- [`apps/api/src/modules/commerce/affiliate-webhook.controller.spec.ts`](../../apps/api/src/modules/commerce/affiliate-webhook.controller.spec.ts): proves raw bytes and all three signing headers reach the verification service unchanged.
- [`apps/api/src/modules/commerce/affiliate-webhook.service.spec.ts`](../../apps/api/src/modules/commerce/affiliate-webhook.service.spec.ts): proves the five verification stages, append-only idempotency, matching, and fail-open analytics behavior.
- [`apps/api/src/modules/commerce/commerce-cache-headers.middleware.spec.ts`](../../apps/api/src/modules/commerce/commerce-cache-headers.middleware.spec.ts): proves the middleware sets a private, non-cacheable policy before continuing.
- [`apps/api/src/modules/commerce/commerce-click-token.spec.ts`](../../apps/api/src/modules/commerce/commerce-click-token.spec.ts): proves click-token HMAC construction, secret strength, and test-only fallback rules.
- [`apps/api/src/modules/commerce/commerce-preferences.controller.spec.ts`](../../apps/api/src/modules/commerce/commerce-preferences.controller.spec.ts): proves authenticated preference reads and writes plus response contract parsing.
- [`apps/api/src/modules/commerce/commerce-retention.service.spec.ts`](../../apps/api/src/modules/commerce/commerce-retention.service.spec.ts): proves the 24-month commercial retention cutoff and failure isolation.
- [`apps/api/src/modules/commerce/commerce.repository.spec.ts`](../../apps/api/src/modules/commerce/commerce.repository.spec.ts): proves the SQL predicates for UTC windows, wildcard regions, dedupe, and persistence.
- [`apps/api/src/modules/feature-flags/feature-flags.service.spec.ts`](../../apps/api/src/modules/feature-flags/feature-flags.service.spec.ts): proves the PostHog, database, and safe-default fallback chain used by the kill switch.
- [`apps/api/src/modules/personalization/ritual.controller.spec.ts`](../../apps/api/src/modules/personalization/ritual.controller.spec.ts): proves commerce is assembled after cache reads and never written into Ritual caches.
- [`apps/api/src/modules/telemetry/telemetry.affiliate.service.spec.ts`](../../apps/api/src/modules/telemetry/telemetry.affiliate.service.spec.ts): proves click and conversion pseudonymization, property validation, and independent sinks.

Real-infrastructure integration tests:

- [`apps/api/integration/commerce-affiliate-offers.integration.spec.ts`](../../apps/api/integration/commerce-affiliate-offers.integration.spec.ts): proves deterministic offer selection, UTC publication windows, wildcard regions, and shared-seed isolation against real PostgreSQL.
- [`apps/api/integration/commerce-affiliate-offers-query-plan.integration.spec.ts`](../../apps/api/integration/commerce-affiliate-offers-query-plan.integration.spec.ts): proves the lookup indexes are usable, buffer reads stay bounded, and the assertions fail when the index contract is removed.
- [`apps/api/integration/commerce-affiliate-clicks.integration.spec.ts`](../../apps/api/integration/commerce-affiliate-clicks.integration.spec.ts): proves real HTTP statuses, 60-second dedupe boundaries, concurrent taps, and redirect safety against real PostgreSQL.
- [`apps/api/integration/commerce-affiliate-webhook.integration.spec.ts`](../../apps/api/integration/commerce-affiliate-webhook.integration.spec.ts): proves unauthenticated delivery, raw-body fidelity, signature boundaries, replay races, telemetry exclusion, and separation from the 24-hour telemetry pruner against real HTTP and PostgreSQL.

Web unit and component tests:

- [`apps/web/src/app/settings/page.test.tsx`](../../apps/web/src/app/settings/page.test.tsx): proves disclosure order, signed-out behavior, optimistic toggling, persistence, confirmation, and error recovery.
- [`apps/web/src/lib/commerce.test.ts`](../../apps/web/src/lib/commerce.test.ts): proves Web preference request and response validation at the API-client boundary.
- [`apps/web/src/i18n/commerce-locales.spec.ts`](../../apps/web/src/i18n/commerce-locales.spec.ts): proves all ten Web catalogs have complete, non-placeholder commerce copy.

Mobile unit and component tests:

- [`apps/mobile/components/hero/outfit-recommendation-card.test.tsx`](../../apps/mobile/components/hero/outfit-recommendation-card.test.tsx): proves the disclosed CTA, partner label, pending state, failure state, and browser handoff.
- [`apps/mobile/src/lib/commerce.test.ts`](../../apps/mobile/src/lib/commerce.test.ts): proves locale derivation, network-only CTA rendering, preference calls, click calls, and in-app browser opening.
- [`apps/mobile/src/lib/native-file-storage.test.ts`](../../apps/mobile/src/lib/native-file-storage.test.ts): proves persisted Ritual data cannot retain a `shopThisLook` block.
- [`apps/mobile/src/screens/hero-affiliate-cta.test.tsx`](../../apps/mobile/src/screens/hero-affiliate-cta.test.tsx): proves network versus cached rendering, once-per-recommendation impressions, cache stripping, and CTA removal on the first Ritual load after opt-out.
- [`apps/mobile/src/screens/tab-two-screen.test.tsx`](../../apps/mobile/src/screens/tab-two-screen.test.tsx): proves the Mobile settings disclosure, preference round trip, accessibility, and all-locale layout bounds.
- [`apps/mobile/src/i18n/commerce-locales.spec.ts`](../../apps/mobile/src/i18n/commerce-locales.spec.ts): proves all ten Mobile catalogs have complete, non-placeholder commerce copy.

Pact contract tests:

- [`pact/http/consumer/mobile-api-client.pacttest.ts`](../../pact/http/consumer/mobile-api-client.pacttest.ts): defines Mobile's expected eligible Ritual, preference, click mint/replay, and webhook interactions against the Pact mock server.
- [`pact/http/consumer/web-api-client.pacttest.ts`](../../pact/http/consumer/web-api-client.pacttest.ts): defines Web's expected eligible Ritual, preference, click mint/replay, and webhook interactions against the Pact mock server.
- [`pact/http/provider/api-provider.pacttest.ts`](../../pact/http/provider/api-provider.pacttest.ts): replays generated consumer contracts against real Nest controllers with scenario-controlled service doubles.

Playwright end-to-end tests:

- [`playwright/tests/api/commerce-affiliate.api.spec.ts`](../../playwright/tests/api/commerce-affiliate.api.spec.ts): proves the seeded public API flow from Ritual eligibility through click dedupe and signed conversion.
- [`playwright/tests/commerce-affiliate-preferences.spec.ts`](../../playwright/tests/commerce-affiliate-preferences.spec.ts): proves the real Web disclosure and opt-out journey, persistence, Axe checks, and keyboard focus.

Mobile end-to-end test:

- [`maestro/commerce-affiliate.yaml`](../../maestro/commerce-affiliate.yaml): exercises the visible Mobile CTA, browser-handoff disclosure text, and settings opt-out flow on a built app.
  It does not tap the CTA or verify the browser opens.
  Story 5.1 records that this flow has not completed end to end.

Performance test:

- [`k6/tests/couture-api-baseline.k6test.ts`](../../k6/tests/couture-api-baseline.k6test.ts): exercises an affiliate-eligible warm Ritual read and enforces the environment-adjusted P95 threshold for the commerce path.

Architecture diagram:

```mermaid
flowchart TD
  Ritual["GET /api/v1/ritual"] --> Svc["RitualService\n(caches payload, no commerce)"]
  Svc --> Ctrl["RitualController\nassembly point"]
  Ctrl --> Elig{"Eligibility, short-circuit\n1 flag, 2 preference, 3 one offer"}
  Elig -- "any failure" --> Null["shopThisLook: null"]
  Elig -- "all pass" --> Block["shopThisLook block\n(no URL)"]
  Block --> Card["Mobile card\ndisclosure before control"]
  Card -- "strip before saveRitualCache" --> Cache["Device cache\nnever renders a CTA"]
  Card --> Click["POST /commerce/affiliate/clicks"]
  Click --> Mint["Mint AffiliateClick\nHMAC token over row id"]
  Mint --> Redirect["redirectUrl on allowed_host"]
  Redirect --> Browser["WebBrowser.openBrowserAsync"]
  Partner["Affiliate partner"]
  Hook["POST /commerce/affiliate/webhook\nno guard, HMAC only"]
  Partner -- "signed over raw bytes" --> Hook
  Hook --> Conv["AffiliateConversion\nappend-only, per (partner, eventId)"]
  Toggle["Settings toggle\nMobile + Web"]
  Pref["CommercePreference\n+ AuditLog in one transaction"]
  Toggle --> Pref
  Pref --> Elig
```

## Step 34: Premium subscription lifecycle

User/business impact:

Turns the product into a paid one.
A signed-in user can subscribe on iOS or Android through App Store or Play billing, or on the web through Stripe Checkout, and the entitlement they paid for shows up everywhere within two minutes.
Upgrade, downgrade, and cancellation work on both rails, managed where the purchase was made: the store's own subscription controls on mobile, the Stripe Customer Portal on web.
Every provider event lands as an append-only billing record, drives one entitlement transition, and writes an audit row.
One operator kill switch stops new purchases; a paying customer can still see, read, and cancel what they have.
This is the first recurring-revenue surface, so the failure modes got as much design weight as the happy path.
A dropped hand-off between Stripe and the entitlement ledger would be a lost payment, and a client-forgeable entitlement row would be free Premium.

Key takeaways:

1. **The database only mirrors entitlement state.**
   RevenueCat is the ledger for all three stores, and exactly one thing writes `PremiumEntitlement` from provider events: the RevenueCat webhook.
   The refresh endpoint and the reconciliation sweep also write, but only by applying a ledger snapshot through the same ordering guard, so one source of truth and one set of rules still hold.
2. **Web purchases join the same ledger.**
   Stripe Checkout completes, and the subscription is forwarded into RevenueCat as a receipt.
   A Stripe-sourced provisional activation was considered and rejected: two writers drift, and bounded delay is a better failure than inconsistent entitlement.
3. **The forward is an outbox obligation.**
   The webhook persists the billing event with the obligation recorded before it acknowledges Stripe, attempts the forward inline, and stamps the result.
   A sweep re-drives anything still owed.
4. **Cancellation keeps access until period end.**
   `CANCELLATION` sets `will_renew` false and leaves the status active; `EXPIRATION` is what removes access at period end.
   Grace period keeps access too, because a card hiccup is usually accidental.
5. **The kill switch is scoped to purchasing alone.**
   Checkout-session creation answers `503` when it is off, and a server-evaluated `purchasesEnabled` flag on the status response is the only path by which the flag reaches a client.
   Status, refresh, the Customer Portal, and both webhooks keep working, because a paying user must always be able to see and cancel a subscription.
6. **Entitlement rows are privilege-bearing, so clients cannot reach them at all.**
   All three billing tables enable row-level security with zero policies and zero grants.
   Even the owner is denied, which is stricter than Step 33's owner-only commerce tables; every read goes through the API.
7. **Receipts are stored as an allowlisted projection.**
   Billing events keep only an enumerated set of fields, so no raw provider body, email, address, card metadata, or promotional code enters the table.
   The full-fidelity record stays in the provider dashboards, which is where refund and tax disputes are worked anyway.
8. **The two-minute promise is split into parts that can be proven.**
   The webhook write is synchronous, so a receipt is visible in the same request cycle.
   The refresh endpoint pulls the ledger on demand.
   Both clients poll on a bounded five-second interval with a hard two-minute stop.
   Provider-to-us delivery latency is monitored without a test, and the story claims no server-side SLO for it.

Hard-won lessons from the implementation and review of this story:

1. **A NestJS `@Cron` in this API has never provably fired in production.**
   The API deploys as one Vercel serverless function.
   No `crons` configuration exists in the repository, and `ScheduleModule.forRoot()` is registered only in the request application.
   Step 33's `CommerceRetentionService` inherited that defect silently.
   So the reconciliation sweep and the re-hosted retention prune both moved onto BullMQ Job Schedulers in the standalone worker runtime, the substrate ADR-012 already set up.
   The remaining `@Cron` consumers belong to other epics; they went to `deferred-work.md` with the evidence and stayed unchanged in this billing story.

2. **An append-only trigger that blocks every `UPDATE` breaks its own outbox.**
   The story specified an UPDATE-blocking trigger on the billing event table, and also forward-outbox columns that a sweep must stamp.
   Implemented literally, the first requirement makes the second impossible.
   So the trigger rejects changes to the financial columns and allows the bookkeeping ones.
   Erasure needs the same reading: PostgreSQL implements `ON DELETE SET NULL` as an `UPDATE` of the referencing row, so a blanket block would have made user deletion fail against the very rows designed to outlive it.
   Two spec clauses can each be correct and still be impossible together; the resolution goes in the migration comment.

3. **Ordering needs three cases, because equal timestamps are real.**
   RevenueCat emits `RENEWAL` and `PRODUCT_CHANGE` pairs carrying identical `occurred_at` values at period boundaries.
   "Newest wins" drops the second one; "drop anything not strictly newer" drops it too.
   The working rule applies an event when it is strictly newer, or when it has the same instant and a different event id.
   All three cases plus the replay case are asserted against the database clock.

4. **A pseudonymous event has no user id to clean up by.**
   The premium telemetry events are pseudonymous, so the telemetry service persists them with a null user id and an HMAC subject.
   A test-quality review recommended scoping an over-broad cleanup by user id.
   That would have matched zero rows forever and silently disabled the cleanup, a worse defect than the one being fixed.
   The correct scope is a suite-start time anchor, the same compromise the shared cleanup helper already makes for unowned rows.
   Review recommendations get verified against the code like any other claim.

5. **A scan that matches nothing looks exactly like a scan that finds nothing.**
   The determinism sweep over thirty-four test files reported a clean result on its first pass.
   BSD `xargs` does not support the `-a` flag that supplied the file list, so the pattern search ran against no files and every check passed vacuously.
   Confirming that thirty-four files actually resolved turned the same command into real signal.
   This is Step 33's unfalsifiable-test lesson again; the defence is asserting the input was non-empty.

6. **Shipping a factory does not mean anything uses it.**
   Task 1 added premium fixture factories that pin the payload allowlist and a set of fixed instants.
   Four integration suites then hand-rolled the same rows anyway, re-hardcoding those instants and re-stating the allowlist, so a projection change would have needed edits in five places.
   The cause was mechanical: the premium factory was the only one in the package missing the repo's `build*CreateInput` convention, so it did not fit the upsert shape the suites needed.
   Adding the convention made the factory usable.

7. **A test id on a `describe` is invisible to a traceability join.**
   The ordering and signature quartets carried their plan range on the enclosing block, and the individual tests were titled with bare numbers.
   Every member was implemented and passing, yet a traceability join on full identifiers found one of four in each group.
   Each test title needs its whole identifier.

8. **"One ledger" is a claim about writers.**
   Precisely stated, one component writes entitlement state.
   The parts list is still two webhook endpoints, a forward outbox, a REST client, and a reconciliation sweep.
   Writing that down in the architecture decision record keeps a later reader from assuming a single integration and finding four.

9. **The degraded mode has a name and a runbook.**
   When the entitlement ledger is unavailable, new activations are delayed while already-synced entitlements keep working from the mirror.
   That state is called paid-but-locked.
   The obligation survives in the outbox, the sweep re-drives it on recovery, the web client shows a bounded pending state, and the operator break-glass is a promotional grant.

10. **Idempotency has to be exercised standalone.**
    The premium seed needed to run on its own, and that surfaced a pre-existing defect: a second `db:seed` without a preceding reset failed on a forecast segment uniqueness collision.
    The seed writes now-relative forecast times, and the new window overlapped the old rows mid-upsert.
    Every seed in this repository claims to be idempotent; only the ones actually run twice in a row have shown it.

11. **Parallel sessions need a foundation that type-checks before they start.**
    The schema, contracts, entitlement core, and feature flag were built and verified first.
    Then three peer sessions worked the Stripe and RevenueCat rails, the mobile surface, and the web surface, on branches stacked on that commit.
    The shared contract was final before fan-out, so the web session could build against endpoints another session had not written yet.
    One cross-session correction landed when the two locale catalogs risked diverging on which keys each surface carries.

Story/Task mapping:

- Story 5.2
- Task 1 (Prisma models, migration, worker-only RLS, seeds, and factories)
- Task 2 (Subscription contracts and premium analytics registries)
- Task 3 (Entitlement service, premium guard, status and refresh endpoints)
- Task 4 (Stripe rail: sessions, webhook, forward outbox)
- Task 5 (RevenueCat rail, reconciliation worker, retention re-host)
- Task 6 (Mobile purchase flow and settings section)
- Task 7 (Web subscription section and planner-rail gate)
- Task 8 (Consumer and provider contracts)
- Task 9 (End-to-end, accessibility, and performance evidence)
- Task 10 (Verification gate, runbook, and architecture decision record)

Story reference:

- `_bmad-output/implementation-artifacts/5-2-premium-subscription-lifecycle.md`
- `_bmad-output/test-artifacts/test-reviews/test-review-5-2-premium-subscription-lifecycle.md`
- `_bmad-output/project-knowledge/premium-release-checklist.md`

Cross-links:

- Step 33 provides the commerce module, the cache-headers middleware, the uniform webhook rejection pattern, and the retention service this story re-hosts onto a substrate that actually fires.
- Step 3 provides the Prisma modeling, migration, and row-level-security foundation, which the three billing tables extend with a stricter worker-only posture.
- Step 8 provides the shared analytics contracts and the pseudonymous subject discipline the four premium events follow.
- Step 15 provides the canonical contract validation and generated-client flow that the subscription contracts and the OpenAPI minor bump pass through.

Sequence to follow:

1. Read `packages/db/prisma/schema.prisma` and `packages/db/prisma/migrations/20260812090000_add_premium_subscription/migration.sql` for the three billing models, the append-only trigger and exactly which columns it exempts, and the zero-policy zero-grant row-level security block.
2. Read `packages/api-client/src/contracts/http/subscription.ts` for the discriminated status union, the wire-only `none` value, the single flag-exposure field, and the seven exported message constants.
3. Read `apps/api/src/modules/commerce/premium-entitlement.service.ts` for the ordering guard, the audit-on-change rule, and the shared telemetry emission rules, then `premium-entitlement.guard.ts` for the access rule.
4. Read `subscription.service.ts` for status serialization, the refresh throttle, and the honest unavailable response when the ledger cannot be reached.
5. Read `stripe-billing.service.ts` and `billing-webhook.service.ts` for session creation, raw-body signature verification, the allowlisted payload projection, and the forward outbox.
6. Read `billing-reconciliation.service.ts` and `apps/api/src/workers/bootstrap.ts` for the sweep's two crash-isolated duties and the job schedulers that run them.
   Then compare against `apps/api/vercel.json` to see why the decorator-based schedule was abandoned.
7. Read `apps/mobile/src/lib/premium.ts` and the settings premium section for the five purchase outcomes and the bounded post-purchase poll.
   Then read `apps/web/src/lib/premium.ts` and `subscription-section.tsx` for the web equivalents and the post-checkout activation poll.
8. Read the evidence in this order: `packages/db/test/premium-schema.spec.ts`, `apps/api/integration/premium-revenuecat-webhook.integration.spec.ts`, `premium-stripe-rail.integration.spec.ts`, `premium-reconciliation.integration.spec.ts`, and the test-quality review in `_bmad-output/test-artifacts/test-reviews/`.

Task owner map:

- Story 5.2 Task 1 step 1 owner: define the billing models, append-only trigger, and worker-only row-level security in `packages/db/prisma/schema.prisma` and its migration.
- Story 5.2 Task 1 step 2 owner: seed the three entitlement states and the purchasing flag in `packages/db/prisma/seeds/commerce.ts` and `feature-flags.ts`.
- Story 5.2 Task 2 step 1 owner: define the subscription HTTP contracts in `packages/api-client/src/contracts/http/subscription.ts`.
- Story 5.2 Task 2 step 2 owner: register the premium analytics events and their property allowlists in `packages/api-client/src/types/analytics-events.ts`.
- Story 5.2 Task 3 step 1 owner: own entitlement reads and writes, including the ordering guard, in `apps/api/src/modules/commerce/premium-entitlement.service.ts`.
- Story 5.2 Task 3 step 2 owner: serialize status and run the ledger refresh in `apps/api/src/modules/commerce/subscription.service.ts`.
- Story 5.2 Task 4 step 1 owner: create Checkout and Portal sessions in `apps/api/src/modules/commerce/stripe-billing.service.ts`.
- Story 5.2 Task 5 step 1 owner: apply provider events and drive the forward outbox in `apps/api/src/modules/commerce/billing-webhook.service.ts`.
- Story 5.2 Task 5 step 2 owner: re-drive owed forwards and correct drift in `apps/api/src/modules/commerce/billing-reconciliation.service.ts`.
- Story 5.2 Task 6 step 1 owner: own the mobile purchase outcomes and poll in `apps/mobile/src/lib/premium.ts`.
- Story 5.2 Task 7 step 1 owner: own the web subscription surface in `apps/web/src/app/components/subscription-section.tsx`.

Tests that cover this step:

Configuration and fixture unit tests:

- [`packages/config/src/flags.spec.ts`](../../packages/config/src/flags.spec.ts): proves the purchasing kill switch is registered and defaults to off.
- [`packages/testing/test/premium.factory.spec.ts`](../../packages/testing/test/premium.factory.spec.ts): proves the billing fixtures pin the payload allowlist, the fixed instants, and the cleanup registration.
- [`packages/testing/test/cleanup.spec.ts`](../../packages/testing/test/cleanup.spec.ts): proves every teardown delete is scoped, including the time-anchored sweep for billing rows with no owner.

Real-PostgreSQL database tests:

- [`packages/db/test/premium-schema.spec.ts`](../../packages/db/test/premium-schema.spec.ts): proves the idempotency barrier, the append-only trigger and its outbox exemption, and that a billing record survives account erasure as an unattributed row.
- [`packages/db/test/rls/billing.spec.ts`](../../packages/db/test/rls/billing.spec.ts): proves an authenticated client is denied reads on all three billing tables and cannot forge an entitlement row.
- [`packages/db/test/commerce-seed.spec.ts`](../../packages/db/test/commerce-seed.spec.ts): proves the premium seed is guarded outside non-production and idempotent across repeated runs.

Shared contract and analytics tests:

- [`packages/api-client/testing/subscription-contract.spec.ts`](../../packages/api-client/testing/subscription-contract.spec.ts): proves an unsubscribed response cannot carry entitlement fields, an entitled one cannot omit them, and no error envelope carries a machine-readable code.
- [`packages/api-client/testing/premium-analytics.spec.ts`](../../packages/api-client/testing/premium-analytics.spec.ts): proves the property allowlists reject prices, receipt identifiers, URLs, and raw user ids.

API unit tests:

- [`apps/api/src/modules/commerce/premium-entitlement.service.spec.ts`](../../apps/api/src/modules/commerce/premium-entitlement.service.spec.ts): proves the ordering guard's three cases and the audit-only-on-change rule.
- [`apps/api/src/modules/commerce/premium-entitlement.guard.spec.ts`](../../apps/api/src/modules/commerce/premium-entitlement.guard.spec.ts): proves grace period keeps access and a missing auth context is denied premium.
- [`apps/api/src/modules/commerce/subscription.service.spec.ts`](../../apps/api/src/modules/commerce/subscription.service.spec.ts): proves status serialization, the refresh throttle, and fail-open telemetry.
- [`apps/api/src/modules/commerce/billing-webhook.service.spec.ts`](../../apps/api/src/modules/commerce/billing-webhook.service.spec.ts): proves the payload projection strips a maximal provider fixture.
- [`apps/api/src/modules/commerce/billing-reconciliation.service.spec.ts`](../../apps/api/src/modules/commerce/billing-reconciliation.service.spec.ts): proves the sweep's duties are crash-isolated, and that unfulfillable obligations are abandoned loudly so the sweep stops rescanning them.
- [`apps/api/src/modules/commerce/billing-reconciliation.scheduler.spec.ts`](../../apps/api/src/modules/commerce/billing-reconciliation.scheduler.spec.ts): proves both job schedulers are registered with the intended cadences.

Real-infrastructure integration tests:

- [`apps/api/integration/premium-subscription.integration.spec.ts`](../../apps/api/integration/premium-subscription.integration.spec.ts): proves the status and refresh endpoints, the guard over real HTTP, and that one account cannot read another's subscription.
- [`apps/api/integration/premium-revenuecat-webhook.integration.spec.ts`](../../apps/api/integration/premium-revenuecat-webhook.integration.spec.ts): proves the full transition table cell by cell, the ordering quartet against the database clock, and the two-user transfer semantics.
- [`apps/api/integration/premium-stripe-rail.integration.spec.ts`](../../apps/api/integration/premium-stripe-rail.integration.spec.ts): proves the signature quartet against the real verifier and the forward outbox's failure path.
- [`apps/api/integration/premium-reconciliation.integration.spec.ts`](../../apps/api/integration/premium-reconciliation.integration.spec.ts): proves a re-driven forward closes the paid-but-locked window, and that drift correction downgrades a stale entitlement the ledger disowns.

Web unit and component tests:

- [`apps/web/src/app/components/subscription-section.test.tsx`](../../apps/web/src/app/components/subscription-section.test.tsx): proves the bounded activation poll, that a mid-poll unsubscribed response does not render as failure, and that subscribe controls appear only when purchasing is enabled.
- [`apps/web/src/app/components/lookbook-prism-layout.test.tsx`](../../apps/web/src/app/components/lookbook-prism-layout.test.tsx): proves the planner rail's locked and unlocked states.
- [`apps/web/src/i18n/premium-locales.spec.ts`](../../apps/web/src/i18n/premium-locales.spec.ts): proves all ten Web catalogs carry complete premium copy.

Mobile unit and component tests:

- [`apps/mobile/src/lib/premium.test.ts`](../../apps/mobile/src/lib/premium.test.ts): proves the post-purchase poll bounds and that the pending-approval outcome does not start one.
- [`apps/mobile/src/screens/settings-premium-section.test.tsx`](../../apps/mobile/src/screens/settings-premium-section.test.tsx): proves all five purchase outcomes and the per-status rendering rules.
- [`apps/mobile/src/i18n/premium-locales.spec.ts`](../../apps/mobile/src/i18n/premium-locales.spec.ts): proves all ten Mobile catalogs carry complete premium copy.

Evidence boundaries at the time of writing:

The consumer and provider contracts, the Playwright journeys, the k6 threshold, and the Maestro flow are Task 8 and Task 9.
They were still in progress when this section was written, so it claims none of them.
Provider behavior is unclaimed too: every provider is faked, so no automated test in this repository makes a real App Store, Play, Stripe, or RevenueCat call.
The only proof of the real chain is the staged smoke run recorded in the premium release checklist.
The nine non-English catalogs remain machine-translation drafts pending human review before release.

Architecture diagram:

```mermaid
flowchart TD
  subgraph Mobile
    MSDK["react-native-purchases\nstore purchase"]
  end
  subgraph Web
    WCO["POST /subscription/checkout-session"] --> Stripe["Stripe Checkout"]
  end
  Stripe -- "checkout.session.completed\n(signed, raw body)" --> SHook["POST /webhooks/stripe"]
  SHook --> BE["BillingEvent\nappend-only, forward_due"]
  BE --> Fwd["Forward to RevenueCat\n(inline attempt)"]
  Fwd -. "on failure, obligation stays due" .-> Sweep["billing-reconciliation-sweep\nevery 15 min, worker runtime"]
  Sweep --> Fwd
  MSDK --> RC["RevenueCat\nentitlement ledger"]
  Fwd --> RC
  RC -- "signed webhook" --> RHook["POST /webhooks/revenuecat\nTHE single entitlement writer"]
  RHook --> Guard{"Ordering guard\nnewer, or equal with a distinct id"}
  Guard -- "older" --> Drop["record only, no transition"]
  Guard -- "apply" --> Ent["PremiumEntitlement\n+ AuditLog, one transaction"]
  Ent --> Status["GET /subscription\nprivate, no-store"]
  Refresh["POST /subscription/refresh"] --> RC
  Refresh --> Ent
  Sweep -- "drift: local active, ledger disowns" --> Ent
  Status --> Clients["Mobile + Web\nbounded 5s poll, 2 min cap"]
  Ent --> PGuard["PremiumEntitlementGuard\nactive or grace passes"]
  Flag["commerce_subscription_enabled"] -- "503 on checkout only" --> WCO
  Flag -- "purchasesEnabled" --> Status
```

## Step 35: Premium theme switcher

User/business impact:

Gives a paying subscriber something to see for the money.
A Premium-entitled user opens web `/settings` and picks one of three interface palettes, **Jewel Radiance**, **Autumn Umber**, or **Winter Metallic**, or reverts to the Default monochrome-and-gold system.
The choice saves server-side against their account, survives reload and re-login, and re-colors the surface immediately without a page reload.
A non-entitled or signed-out reader sees a locked panel that names Premium once and points at the subscribe controls, with no modal, no countdown, and no fake urgency.
This is the first surface where story 5.2's `PremiumEntitlementGuard` gates a real production write path.
The cosmetic feature also carries a hard contract: a unit test pins the WCAG 2.2 AA ratio of every text-on-background pairing the gallery renders, so a designer nudging a hex value into unreadable copy breaks the build.

Key takeaways:

1. **Two upstream documents can name a thing that does not exist.**
   The epic asks for "Midnight Noir" and the PRD adds "Aurora Dawn," and neither name has a hex value anywhere in the repository.
   Both are placeholders written before the UX pass named the real palettes.
   The UX spec and its reference file define three shipped palettes with quoted values, and `epics.md:534` records the complexity bump that confirms the UX pass is the newer source.
   Decide which document governs, say so in writing, and state that the discarded names appear nowhere in code.
2. **When prose and a reference file disagree, ship whichever one the spec designates for engineering.**
   `ux-design-specification.md:78-80` lists a Wine Red and a Chestnut that `refs/ux/ux-color-themes.html` does not use, while the HTML carries the complete card-preview pairings the prose never mentions.
   The spec names the HTML as the precise-values reference at `:113`, so the HTML wins.
   The decision says plainly that the two prose colors must not be "restored" later.
3. **Contrast is computed and pinned.**
   `packages/utils/src/contrast.ts` became the canonical home of the WCAG relative-luminance maths.
   Its spec pins six ratios with `toBeCloseTo(ratio, 2)`, because these are floating-point results.
   Exact `toBe` equality cannot provide the tolerance those results need.
   The pinning keeps the story's own contrast table honest over time.
   Two of the three primary-accent-plus-white-text combos fail the 4.5:1 floor (Autumn Umber 4.28:1, Winter Metallic 3.57:1), so they are restricted to large or bold text and icon-only controls under the 3:1 floor.
   All body copy uses the card-preview pairings, which clear 8.01:1 to 11.58:1.
4. **The right move was consolidation.**
   Two correct copies of this maths already sat in `playwright/`.
   The easy mistake was adding a third without noticing, so the decision opens by naming both existing copies and their file positions.
5. **Effective state resolves server-side, in one round trip.**
   A user can pick a palette and later let Premium lapse.
   The theme service asks `PremiumEntitlementService.hasPremiumAccess(userId)` inline and returns `{ theme, isEntitled, themesEnabled }` together, so no client has to combine `/subscription` with the theme response.
   Each client has one source of truth and no policy to keep in sync across two surfaces.
6. **Reset is an upsert to `null`; the preference row is kept for good.**
   An absent row and `theme: null` both mean Default, which is the two-spellings-of-one-fact trap the enum design refused.
   It is tolerable only because one spelling is unreachable by choice: a row appears the first time a user touches the gallery and stays.
   Delete-on-reset passes a single-user unit test and diverges the moment `updated_at` or an adoption count matters.
7. **Owner-only RLS fits, because a cosmetic preference carries no privilege.**
   This is the deliberate opposite of story 5.2's billing tables, which enable row-level security with zero policies and zero grants so that even the owner is denied.
   A palette choice is safe for the authenticated user to read and write directly, so the table joins `selfOnlyTables` on the same `private.can_manage_self_row` template as `CommercePreference`.
   Match the RLS posture to what the row can buy.
8. **Guard precedence is written into the decision up front.**
   `PremiumEntitlementGuard` is a NestJS guard and runs before the handler; the kill-switch check lives in the service body.
   So a non-entitled caller always gets `403` regardless of the flag, and only an entitled caller can ever see the `503`.
   This is intentional: only a payer needs to know the feature is switched off for now.
9. **Staying inside an existing route prefix inherits its middleware for free.**
   `CommerceCacheHeadersMiddleware` is bound to `/api/v1/commerce{/*path}`, so mounting at `/api/v1/commerce/premium/theme` picks up `private, no-store` with zero new wiring.
   A new top-level `/api/v1/premium` namespace would have been the only one of its kind in the repository, and would have shipped a per-user response with no cache headers.
   A supertest assertion pins the header so a later route move cannot drop it silently.
10. **Ship the primitive plus exactly one demonstration surface.**
    No design-token package exists in this repository; `architecture.md:85-88` describes `packages/tokens` but it was never built.
    Retrofitting the hero canvas, Lookbook Prism, the chip system, and the button hierarchy to read new tokens is unbounded, high-regression scope.
    This story builds the carrier, five custom properties under `[data-theme]` in `globals.css`, and proves it live on the gallery itself.
    Each other surface owns its own adoption, recorded in `deferred-work.md`.
11. **The flag ships off; that is the rollout plan.**
    `premium_themes_enabled` has a registry `defaultValue` of `false`; the `true` lives only in the database seed.
    So the feature is on wherever the seed has run and off everywhere else, production included, until someone flips it.
    Two consequences follow, and both are written down.
    An integration test that skips the seed correctly sees `themesEnabled: false` and a `503`.
    The entitled-user `503` is reachable in production and needs AC 6's clean fallback.
12. **A cited design decision can answer a requirement.**
    Both `epics.md:443` and `prd.md:205` require the palette to apply on the watch.
    `ux-design-specification.md:381` decides that wearable cards stay monochrome with a gold ring, so a 1.5-inch screen stays glanceable whatever the wearer picked.
    No Swift or Kotlin file was touched, and both citations are recorded in `deferred-work.md` so a later reader sees the requirement as answered.

Hard-won lessons from the implementation and code review of this story:

1. **An attribute with no consumer looks exactly like a working feature.**
   The web surface wrote `data-theme` onto `<html>` correctly, and selecting a palette re-colored nothing.
   Every `--theme-*` variable was consumed inside `PaletteCard`, which pins its own `data-theme` so each card can preview its own palette, and that rule beat the inherited value from the root.
   So the card looked identical whether or not the attribute ever reached `<html>`.
   The fix is structural: `LivePreview` deliberately pins no `data-theme` of its own, so it is the one element on screen whose appearance changes only if the root attribute landed.
   A demonstration surface has to contain at least one element the mechanism cannot fake.
2. **A Postgres enum rejects a retired member before application code sees a string.**
   AC 6's stale-palette fallback was implemented at the Zod layer and verified with unit doubles, which pass a string through.
   Against a real database, a row holding a since-removed enum member makes the query engine reject it with `P2023` before `normalizeStoredTheme` is ever called.
   So the settings page would have 500'd on the exact scenario the criterion names.
   `readStoredTheme` now catches that one code and resolves Default.
   Every other Prisma error still propagates, because swallowing a connection fault would render Default while reporting success.
3. **A refused save that only prints a line leaves the surface lying.**
   Entitlement can lapse and the kill switch can flip while `/settings` is open.
   The catch set error text and nothing else, so `isEntitled` and `themesEnabled` stayed stale at `true`.
   Every card stayed clickable, each further click failed the same way, and the locked panel and kill-switch note were unreachable.
   A failed write has to re-resolve the section's state.
4. **Baked-in English defeats a ten-catalog localization gate without failing it.**
   The web lib threw errors whose `message` was an English sentence, so the section's translated fallbacks were dead code, and `loadError` and `saveError` shipped unreachable in all ten catalogs.
   The parity spec stayed green throughout, because it only proves the keys exist.
   The fix is classification: the lib returns a `PremiumThemeFailureReason` and the component chooses the catalog string.
   `message` stays developer-facing for logs.
5. **The same defect was already live in story 5.2, and its own tests were holding it in place.**
   `subscription-section.test.tsx` asserted the server's English string literally, so the suite passed _because_ of the bug, and the locale parity spec only ever checked key existence.
   It was first deferred as another story's surface, and that call was reversed: debt gets handled when it is found, whichever story introduced it.
   `apps/web/src/lib/premium.ts` now classifies failures with a per-operation status map.
   `409` means "you already have one" on checkout and "manage it in the store" on the portal, and a single global table would have merged the two.
6. **An RLS actor matrix proves refusal and says nothing about permission.**
   Every seed insert in that suite goes through the superuser admin pool, which bypasses row-level security, so the `WITH CHECK` clause was only ever shown to deny.
   A policy of `WITH CHECK (false)` would have passed the entire matrix while making the feature's very first write impossible.
   Owner INSERT, owner DELETE, and a `theme = NULL` insert now run through the `authenticated` role.
7. **Policies and grants fail in opposite directions, so both need pinning.**
   Correct policies with no `GRANT` deny even the owner; correct grants with no policies expose every row.
   The `packages/db/test/rls/` suite owns the actor matrix and proves nothing about the privileges underneath it.
   So the schema spec pins `authenticated` to exactly the four owner verbs and `anon` to none, and checks the four policy names.
8. **A hand-copied enum drifts silently and fails open.**
   `types/` does not import from `contracts/`, so the analytics palette list was copied by hand with nothing making the two agree.
   A fourth palette would have been accepted and persisted correctly, then failed its analytics parse inside `TelemetryService`, where the emit path catches and continues.
   That means correct data and zero events, found only as a gap in a dashboard weeks later.
   A set-equality test against the contract enum closes it.
9. **A suite gated on an environment variable nobody sets is green by absence.**
   `weather-alert-cooldown.integration.spec.ts` was gated on `ALERT_COOLDOWN_REAL_DB_INTEGRATION`, which no workflow, npm script, or document sets anywhere in the repository.
   So it had never executed, and a foreign-key break inside it was invisible.
   It now uses the schema probe every sibling integration suite uses, which runs wherever a database is reachable and skips with a stated reason where one is not.
   This is Step 34's matched-nothing lesson again.
10. **Re-selecting the value you already have is a real event.**
    The concurrency guard covered a second click during an in-flight save but not an idle click on the already-selected card.
    So one real choice could emit several `premium_theme_selected` events and inflate the adoption number the event exists to measure.
    The server answers `200` for an unchanged value by design, so the client is the only place to suppress this.
11. **`readonly` is erased at runtime.**
    The exported palette key list aliased the Zod enum's live `options` array, and this repository already contains code that mutates that array by reference.
    The fix is a frozen copy.
12. **Duplicate test ids make a failure report ambiguous.**
    Four ids were each used twice across two tiers.
    The matrix id stays on the test the story's own wording points at, and the sibling takes a new one, so a red build names one test.
13. **A deliberate scope cut has to be written in both places or the documents contradict each other.**
    Tasks 6 and 7 were cut so the higher test tiers could be authored separately.
    They are marked cancelled in the story with pointers to their `deferred-work.md` entries, and the story stays `in-progress`, so nothing reads as forgotten.

Story/Task mapping:

- Story 5.3
- Task 1 (Prisma enum and model, migration with owner-only RLS, factory, schema spec)
- Task 2 (`@couture/utils` contrast helper and its pinned ratio fixtures)
- Task 3 (Premium theme contracts, OpenAPI 1.2.0 to 1.3.0, analytics registries)
- Task 4 (`PremiumThemeService` and `PremiumThemeController` under the commerce prefix)
- Task 5 (Web lib, `[data-theme]` custom properties, `PremiumThemeSection`, locale catalogs)
- Task 6 (Mobile surface): **cancelled for this pass**, recorded in `deferred-work.md`
- Task 7 (Pact, Playwright, Maestro, and the Playwright contrast adapter): **cancelled for this pass**, recorded in `deferred-work.md`
- Task 8 (Coverage ratchets, `verify:changed` gap list, deferred-work ledger)

Story reference:

- `_bmad-output/implementation-artifacts/5-3-premium-theme-switcher.md` (including its `Review Findings` section, which records every patched and dismissed finding)
- `_bmad-output/implementation-artifacts/deferred-work.md`, sections "Deferred from: story 5.3 premium theme switcher (2026-08-18)" and "Added during the story 5.3 code review (2026-08-18)"
- `refs/ux/ux-color-themes.html`: the palette values every surface is pinned to
- This story has no test-quality review artifact; Step 34 has one.

Cross-links:

- Step 34 provides `PremiumEntitlementService.hasPremiumAccess`, the `PremiumEntitlementGuard` this story gives its first production write path, the commerce module, and the cache-headers middleware binding the new route inherits.
- Step 3 provides the Prisma modeling, migration, and row-level-security foundation this table extends with an owner-only posture.
- Step 8 provides the analytics contracts and the pseudonymous-subject discipline `premium_theme_selected` follows.
- Step 15 provides the canonical contract validation and generated-client flow the new Zod module and the additive OpenAPI minor bump pass through.
- Step 22 provides the ten-catalog localization infrastructure and the parity-spec convention the new dedicated spec follows.
- Step 28 provides the accessibility hardening work whose Playwright helper holds the two pre-existing copies of the contrast maths this story consolidates against.

Sequence to follow:

1. Read `packages/db/prisma/schema.prisma` for the `PremiumThemeKey` enum and the `PremiumThemePreference` model.
   Then read `packages/db/prisma/migrations/20260818090000_add_premium_theme/migration.sql` for the grant, the `ENABLE ROW LEVEL SECURITY`, and the four owner-only policies.
   Compare the posture against story 5.2's zero-policy billing tables in the same file.
2. Read `packages/api-client/src/contracts/http/premium-theme.ts` for the response shape that always serializes `theme`, `isEntitled`, and `themesEnabled`, the `.strict()` input schema where `null` means reset, and `PREMIUM_THEMES_DISABLED_MESSAGE`.
3. Read `packages/utils/src/contrast.ts` for the luminance maths and the two WCAG thresholds, then `contrast.spec.ts` for the six pinned ratios that keep the story's contrast table honest.
4. Read `apps/api/src/modules/commerce/premium-theme.service.ts` in this order: the docblock's statement of why the row is never deleted, `getTheme` for the inline entitlement resolution, `readStoredTheme` for the `P2023` catch, and `emitSelection` for the fail-open analytics path.
5. Read `premium-theme.controller.ts` for the guard stack, the flag assertion that runs before body parsing, and both handlers parsing their return through the published schemas.
6. Read `apps/web/src/lib/premium-theme.ts` for `PremiumThemeFailureReason`, the frozen key list, and `applyWebThemeAttribute`.
   Then read `apps/web/src/app/globals.css` for the four `[data-theme]` blocks and the five custom properties each defines.
7. Read `apps/web/src/app/components/premium-theme-section.tsx` top to bottom, starting with its header comment.
   It explains why `PaletteCard` pins its own `data-theme` and why `LivePreview` deliberately does not.
8. Read the evidence in this order: `packages/utils/src/contrast.spec.ts`, `packages/db/test/premium-theme-schema.spec.ts`, `apps/api/src/modules/commerce/premium-theme.service.spec.ts`, and `apps/web/src/app/components/premium-theme-section.test.tsx`.

Task owner map:

- Story 5.3 Task 1 step 1 owner: define the `PremiumThemeKey` enum, the `PremiumThemePreference` model, and the `User` back-relation in `packages/db/prisma/schema.prisma`.
- Story 5.3 Task 1 step 2 owner: own the grants, the row-level-security enablement, and the four owner-only policies in `packages/db/prisma/migrations/20260818090000_add_premium_theme/migration.sql`.
- Story 5.3 Task 1 step 3 owner: build and persist theme fixtures in `packages/testing/src/factories/premium.factory.ts`, registered in `packages/testing/src/factories/registry.ts` and `packages/testing/src/cleanup.ts`.
- Story 5.3 Task 2 step 1 owner: own the WCAG luminance maths and the two AA thresholds in `packages/utils/src/contrast.ts`.
- Story 5.3 Task 3 step 1 owner: define the premium theme HTTP contracts and the disabled message constant in `packages/api-client/src/contracts/http/premium-theme.ts`, registered through `packages/api-client/src/contracts/http/openapi.ts`.
- Story 5.3 Task 3 step 2 owner: register `premium_theme_selected` and its `{ theme }` property allowlist in `packages/api-client/src/types/analytics-events.ts` and `packages/api-client/src/testing/analytics-event-assertions.ts`.
- Story 5.3 Task 3 step 3 owner: own the server-side pseudonymous emission for the new event in `apps/api/src/modules/telemetry/telemetry.service.ts`.
- Story 5.3 Task 4 step 1 owner: resolve entitlement, the kill switch, and the stored preference in `apps/api/src/modules/commerce/premium-theme.service.ts`.
- Story 5.3 Task 4 step 2 owner: own the route, the guard stack, and response parsing in `apps/api/src/modules/commerce/premium-theme.controller.ts`, registered in `apps/api/src/modules/commerce/commerce.module.ts`.
- Story 5.3 Task 5 step 1 owner: own transport, failure classification, and the root attribute write in `apps/web/src/lib/premium-theme.ts`.
- Story 5.3 Task 5 step 2 owner: own the palette custom properties in `apps/web/src/app/globals.css`.
- Story 5.3 Task 5 step 3 owner: own the gallery, locked, loading, unavailable, and error states in `apps/web/src/app/components/premium-theme-section.tsx`, mounted from `apps/web/src/app/settings/page.tsx`.
- Story 5.3 Task 5 step 4 owner: own the `commerce.premium.theme.*` subtree across the ten catalogs in `apps/web/src/i18n/locales/`.

Tests that cover this step:

Shared utility unit tests:

- [`packages/utils/src/contrast.spec.ts`](../../packages/utils/src/contrast.spec.ts): pins the six audited ratios with `toBeCloseTo(ratio, 2)` (`5.3-UTIL-001` through `5.3-UTIL-006`), proves the flattened Winter Metallic card background is the worse of the two gradient stops (`5.3-UTIL-008`), and rejects eight-digit `#RRGGBBAA` input.
  `5.3-UTIL-007` is deliberately absent and reserved for the deferred Playwright adapter.

Real-PostgreSQL database tests:

- [`packages/db/test/premium-theme-schema.spec.ts`](../../packages/db/test/premium-theme-schema.spec.ts): proves the unique `user_id`, the nullable `theme`, cascade delete with the account, and the privilege breadth the actor matrix cannot see: `authenticated` holds exactly four owner verbs and `anon` none (`5.3-DB-014`, `5.3-DB-015`).
- [`packages/db/test/rls/premium-theme.spec.ts`](../../packages/db/test/rls/premium-theme.spec.ts): runs the full owner-only actor matrix over the new table (`5.3-DB-001` through `5.3-DB-008`), including the INSERT policy's positive half, driven through the `authenticated` role because the admin pool bypasses RLS.

Shared contract and analytics tests:

- [`packages/api-client/testing/premium-theme-contract.spec.ts`](../../packages/api-client/testing/premium-theme-contract.spec.ts): proves the response always serializes all three fields, that `null` is a valid reset value, that the input schema is `.strict()`, and that the published enum carries exactly the three shipped palettes (`5.3-CONTRACT-01` through `5.3-CONTRACT-15`).
- [`packages/api-client/testing/premium-theme-analytics.spec.ts`](../../packages/api-client/testing/premium-theme-analytics.spec.ts): proves the property allowlist rejects anything beyond `{ theme }`, and pins the analytics palette list to the contract enum by set equality so a fourth palette cannot fail open (`5.3-CON-007`).

API unit tests:

- [`apps/api/src/modules/commerce/premium-theme.service.spec.ts`](../../apps/api/src/modules/commerce/premium-theme.service.spec.ts): proves the inline entitlement resolution, that reset upserts `theme = null` and never deletes, and that a stored enum member this build does not know resolves to Default while other Prisma failures still propagate (`5.3-API-011c`, `5.3-API-011d`).
- [`apps/api/src/modules/commerce/premium-theme.controller.spec.ts`](../../apps/api/src/modules/commerce/premium-theme.controller.spec.ts): proves the guard stack over HTTP, the `403`-before-`503` precedence for a non-entitled caller, the entitled caller's `503` when the kill switch is off, and that the GET response carries the inherited `private, no-store` header.
- [`apps/api/src/modules/telemetry/telemetry.premium.service.spec.ts`](../../apps/api/src/modules/telemetry/telemetry.premium.service.spec.ts): proves the palette selection emits under the acting user's pseudonym, that a reset still emits an event with a null theme, that no event is emitted without an authenticated user, and that a palette the contract does not ship is rejected.

Fixture and cleanup tests:

- [`packages/testing/test/premium.factory.spec.ts`](../../packages/testing/test/premium.factory.spec.ts): proves the theme preference fixture, its `build*CreateInput` shape, and its cleanup registration (`5.3-FACTORY-01` through `5.3-FACTORY-03`).
- [`packages/testing/test/cleanup.spec.ts`](../../packages/testing/test/cleanup.spec.ts): proves the new delegate is scoped and ordered correctly in teardown.

Web unit and component tests:

- [`apps/web/src/lib/premium-theme.test.ts`](../../apps/web/src/lib/premium-theme.test.ts): proves failure classification into `PremiumThemeFailureReason`, that the exported key list cannot be mutated through the Zod enum's live options array, that an unknown stored key resolves to Default, and that `applyWebThemeAttribute` writes and clears the root attribute.
- [`apps/web/src/app/components/premium-theme-section.test.tsx`](../../apps/web/src/app/components/premium-theme-section.test.tsx): proves the gallery, locked, loading, unavailable, and error states; that a refused save re-resolves the section (`5.3-WEB-107`, `5.3-WEB-114`); that re-pressing the selected card sends nothing (`5.3-WEB-115`); that the session is re-read before a write (`5.3-WEB-116`); that an in-flight save is aborted on unmount (`5.3-WEB-118`); and that the signed-out panel names the sign-in step and only controls present on the page (`5.3-WEB-101`, `5.3-WEB-117`).
- [`apps/web/src/app/settings/page.test.tsx`](../../apps/web/src/app/settings/page.test.tsx): proves the section is mounted as the third child of `/settings` alongside the commerce and subscription sections (`5.3-WEB-SETTINGS-01`).
- [`apps/web/src/i18n/premium-theme-locales.spec.ts`](../../apps/web/src/i18n/premium-theme-locales.spec.ts): proves the `commerce.premium.theme.*` subtree is complete, placeholder-consistent, and non-empty across all ten catalogs, with an `APPROVED_COGNATES` allowlist for the palette proper nouns (`5.3-I18N-WEB-01` through `5.3-I18N-WEB-10`).
- [`apps/web/src/i18n/premium-locales.spec.ts`](../../apps/web/src/i18n/premium-locales.spec.ts): its pinned `commerce.premium.*` key list now excludes the `theme` subtree that moved into its own spec.
  `apps/web/src/i18n/commerce-locales.spec.ts` needed the same one-line exclusion when story 5.2 added `commerce.premium.*`.
- [`apps/web/src/app/components/subscription-section.test.tsx`](../../apps/web/src/app/components/subscription-section.test.tsx): after the story 5.2 follow-up, proves the checkout `409`, a mid-session `401`, and the portal's `409` and `404` render catalog copy and that the server's English string is absent (`5.2-WEB-SEC-22` through `5.2-WEB-SEC-25`).

Evidence boundaries at the time of writing:

The mobile surface, the Pact interactions, the Playwright journeys, the Maestro flow, and the Decision 3 rewrite of `playwright/support/helpers/accessibility.ts` were held back so the higher test tiers could be authored separately.
Each is recorded in `deferred-work.md` with the exact shape it should take.
That leaves these unproven: consumer-driven compatibility between each client and the provider; browser-level behavior of the locked state under axe, the gallery, select-then-reload persistence, and the Default fallback for a stale key seeded directly; and everything on the mobile surface, including the mobile halves of AC 4, AC 6, and AC 7.
The story's own coverage matrix names `5.3-INT-001` and `5.3-INT-002` as evidence for AC 3, and neither has a test yet.
The repository holds three copies of the WCAG luminance maths where Decision 3 intended two; two recorded deferred-work entries bring it back to one.
Story 5.3 stays `in-progress` in `sprint-status.yaml` for these reasons.
The nine non-English catalogs remain machine-translation drafts pending human review, as they have since Step 22.

`npm run verify:changed` did run and exits 0 across all seven touched workspaces, with every coverage ratchet holding and 3270 tests passing, run with `DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres`.
Without that variable the database-backed suites skip themselves, and the ratchet fails on coverage with no mention of the missing database.
Step 34's gap list now documents that trap in `development-guide.md`.

Architecture diagram:

```mermaid
flowchart TD
  UX["refs/ux/ux-color-themes.html\nthe pinned hex source"] --> CSS
  UX --> CONTRAST["packages/utils/src/contrast.ts\ncontrastRatio + meetsWcagAA"]
  CONTRAST --> SPEC["contrast.spec.ts\nsix ratios pinned toBeCloseTo(x, 2)"]

  subgraph Web
    SEC["PremiumThemeSection\ngallery / locked / error"]
    CSS["globals.css\n[data-theme] blocks, 5 custom properties"]
    LIB["lib/premium-theme.ts\nclassify failure, write root attribute"]
  end

  SEC --> LIB
  LIB -- "GET /api/v1/commerce/premium/theme" --> CTRL
  LIB -- "PUT (entitled only)" --> CTRL
  LIB -- "document.documentElement.dataset.theme" --> CSS
  CSS --> PREVIEW["LivePreview\npins no data-theme,\nthe one element the root attribute must reach"]

  CTRL["PremiumThemeController\n@UseGuards(RequestAuthGuard)"] --> GUARD{"PremiumEntitlementGuard\nPUT only, runs pre-handler"}
  GUARD -- "not entitled" --> F403["403 PREMIUM_REQUIRED_MESSAGE\nregardless of the flag"]
  GUARD -- "entitled" --> SVC
  CTRL -- "GET, no guard" --> SVC

  SVC["PremiumThemeService"] --> ENT["PremiumEntitlementService\nhasPremiumAccess, resolved inline"]
  SVC --> FLAG{"premium_themes_enabled\ndefault false, true only in the seed"}
  FLAG -- "off, entitled caller" --> F503["503 PREMIUM_THEMES_DISABLED_MESSAGE"]
  SVC --> ROW["PremiumThemePreference\none row per user, upsert(null) on reset,\nnever deleted"]
  ROW -- "P2023 on a retired enum member" --> DEFAULT["resolve Default\nother Prisma errors propagate"]
  SVC -- "on successful PUT" --> TEL["TelemetryService\npremium_theme_selected, pseudonymous, fail-open"]
  ROW --> RLS["RLS: selfOnlyTables\nprivate.can_manage_self_row, owner-only CRUD"]
  SVC --> RESP["{ theme, isEntitled, themesEnabled }\nprivate, no-store via CommerceCacheHeadersMiddleware"]
  RESP --> LIB
```

## Step 36: Colour palette, beauty and accessory advisor

User/business impact:

Gives a paying subscriber makeup shades and accessory pairings matched to their own tones.
A Premium-entitled user opens web `/palette` or the mobile palette advisor, grants explicit consent, and derives an undertone one of two ways.
A selfie yields **undertone and depth**.
The colours already stored for their wardrobe yield **undertone only**, and the result says so.
The result drives a versioned first-party rule table across five slots (foundation, blush, jewelry, bag, eyewear).
Each card can be saved or dismissed, and a dismissal is permanent until undone.
Zero or one affiliate offer may attach to a slot, disclosed before its own control and suppressed by the user's existing global commerce opt-out.

Consent is a persisted, revocable, server-enforced fact.
Every grant and revoke writes an immutable `AuditLog` row, and withdrawing consent erases the derived palette through the same path as `DELETE`.
The selfie bytes are purged from storage the moment the analysis terminates, on success or failure, leaving only four scalars.
This is the first surface in the repository that reads a photograph of a user's face, and the first whose retention posture is tighter than the story it was modelled on.

Key takeaways:

1. **Three source documents disagreed, and the ADR plus the shipped code won.**
   `ux-design-specification.md:409` says the pipeline is on-device; `architecture.md` ADR-014 says server-side in detail and gives its reasons; `prd.md:294` asks to confirm the on-device constraints.
   ADR-014 is three days newer and was written to close the PRD's open question.
   The deciding fact is that the shipped `WardrobeColorProcessor` already runs Sharp inside the API.
   Building an on-device path would have meant two colour pipelines with different answers.
   The stale lines are recorded in `deferred-work.md` as documents to amend.
2. **Declining part of an ADR is fine when the divergence is written down.**
   ADR-014 prescribes "Sharp -> ONNX Runtime".
   This story takes its location decision, its privacy posture and its budget, and declines the ONNX step.
   The output is one four-way and one five-way classification that closed-form CIELAB colour science settles exactly, while the repository's only ONNX consumer already carries a 50 MB model directory and a prestart verification gate for a genuinely learned task.
   The divergence is written into the story's Decision 2 and into `deferred-work.md` against ADR-014, so the ADR can be amended.
3. **Classify undertone on the CIELAB hue angle.**
   A `b*/a*` ratio divides by `a*`, which is near zero for neutral skin and negative for a wardrobe mean pulled green or cyan.
   So the ratio both blows up and silently inverts the comparison at exactly the inputs the feature has to get right.
   `atan2(b*, a*)` is defined everywhere except `a* = b* = 0`, which the chroma screen already excludes.
4. **Colour has to be linearized before it is averaged.**
   The mean of two sRGB byte values is darker than the true halfway colour, so every pixel is linearized before it is combined.
   `WardrobeColorProcessor.extractDominantHex` already takes that approximation over `.stats()` channel means; reproducing it here would have biased every derived undertone toward the darker input.
5. **Reuse before you write the maths a third time.**
   `contrast.ts` already held the WCAG linearization from Step 35, but `parseHex` and `relativeLuminance` were module-private.
   `relativeLuminance` also collapsed three linearized channels into one 709-weighted scalar, so it never yielded the per-channel values CIEXYZ needs.
   Task 2 therefore opens by exporting `srgbChannels` and `linearizeSrgbChannel` and refactoring `relativeLuminance` to compose them.
   `contrast.spec.ts` passing unchanged is the proof of no behaviour change.
   Only then does `skin-tone.ts` get written.
6. **`no_face` has to mean something a machine can decide.**
   There is no face detector and no new dependency.
   Sharp's `.stats()` returns whole-image means, and a selfie is mostly not skin.
   So the isolation is a centre crop plus the published Chai-Ngan YCbCr chroma bounds, computed on the **gamma-encoded** bytes because those bounds are published against BT.601 over R'G'B'.
   Linearization comes after the gate, on the survivors only.
   "No face" then has a precise meaning: fewer than 15% of the cropped pixels are skin-chromatic.
7. **Report confidence, and refuse below a floor.**
   Both sources return a `[0, 1]` confidence, and both refuse to publish below 0.4, since a user will read a low-confidence answer as fact about their body.
   The wardrobe path ends that refusal as `insufficient_wardrobe`: the `low_quality` copy is photo-specific in all ten catalogs, and showing it to someone who never uploaded a photo would be wrong.
8. **Extend the catalog by two nullable columns.**
   `AffiliateOffer.garment_category` had no honest value for a foundation offer.
   Adding a `beauty` member would pollute a wardrobe enum that garments, tagging and capsules all read.
   A separate `AdvisorOffer` table would make `AffiliateClick.offer_id` polymorphic and duplicate the partner, token, webhook and conversion machinery.
   Two nullable columns plus a `CHECK (num_nonnulls(garment_category, advisor_slot) = 1)` constraint make each row exactly one kind, and make a row that could satisfy both selections unrepresentable.
9. **SQL NULL semantics are a real guarantee and a fragile one.**
   The garment query filters `garment_category = $n` and the advisor query filters `advisor_slot = $n`, so neither can ever return the other's rows.
   That holds until someone adds an `OR ... IS NULL` for a wildcard feature, so the guarantee is asserted in both directions at two tiers.
10. **The click path is where the two can cross, and NULL semantics do not protect it.**
    `findActiveClickOffer` looks a row up by id plus status and window and deliberately skips re-deriving the slot match, so any active offer id is clickable with any `surface` a caller sends.
    The branch therefore keys on the offer row's `advisor_slot`.
    Keying on the client's `input.surface` would let a caller mint `advisor_offer_clicked` for a garment offer, or route a real advisor click into the scenario-lookup dead end that emits nothing.
11. **Consent is a persisted server fact.**
    Story 4.4's My Form photo uses a `z.literal(true)` the client always sends, which is adequate for basewear guidance.
    It is not adequate for image-derived body characteristics, and `epics.md:576` asks for logged opt-ins, which is an audit requirement.
    There is one server-side gate, audited both ways, and revocation erases the data.
12. **There are three doors to a terminal status.**
    A photo reaches `ready` in the processor, reaches a failure in the processor, and reaches `timeout`/`storage_error` from the worker's catch block on the final attempt.
    That third door never runs the processor body at all.
    A purge written only inside `process()` leaks every selfie whose analysis exhausts its retries: the same permanent-retention bug the decision exists to prevent, through a different door.
    One private purge method is called from all three.
13. **Commit the terminal status first, then purge, and make only the purge best-effort.**
    Purging first means a crash between the two leaves the row in `processing` with no bytes to re-read, and the retry then fails its download for the whole retention window.
    The status commit is the durable fact.
14. **A consent-gated feature that reads faces should fail closed.**
    `color_analysis_enabled` had a registry default of `true`, out of step with every other premium and commerce gate.
    Flipping it to `false` and putting the `true` in the seed turns the feature on wherever the seed has run and off everywhere else, production included.
    That single flip forces five edits, three of them breakages in different workspaces.
    Miss the seed and every positive-path test fails looking like a feature bug.
15. **The erase route is deliberately the one route with no entitlement guard.**
    A lapsed subscriber must always be able to delete data the product holds about their face.
    So both surfaces route "withdraw consent" through `DELETE`.
    `POST /consent { granted: false }` mounts the guard and checks the kill switch, so routing withdrawal through it would strand exactly the person who most wants out.

Hard-won lessons from the implementation and code review of this story:

1. **A contract that documents a header in prose does not send it.**
   The two idempotent POSTs described `Idempotency-Key` handling in their OpenAPI descriptions and declared no `headers` block.
   So the generated client had no parameter for it, while the controller rejects a missing or non-UUID key with `400`.
   The entire selfie upload lifecycle was uncallable from either surface and every server-side test was green, because the defect was in the contract.
   The bytes route was under-declared the same way: no `security`, no `x-upload-token`, no binary body.
2. **A response can be complete and still make a feature impossible.**
   The advisor's sponsored CTA activates through story 5.1's click endpoint, which requires a `recommendationId` that the story defines as the `PaletteProfile.id`.
   Nothing published that id.
   Every field the panel rendered was correct; the one field the next request needed was absent.
3. **A dedupe index is only a rate limit while the client cannot choose its columns.**
   The advisor click's `recommendation_id` was taken from the request body, and the 60-second dedupe index is `(user_id, offer_id, recommendation_id, minute)`.
   So a caller who varied the third column could mint unlimited attributed clicks for one offer inside one minute.
   It is now re-resolved from the session.
   The garment path still trusts its client value, and that asymmetry is recorded.
4. **An existence check proves nothing about consent.**
   The server-side resolution then answered with a consent message while only proving a row existed.
   `erase()` deliberately keeps the row with `consent_revoked_at` stamped, so a user who had erased their palette kept minting attributed clicks.
   The fix applies the same `hasCurrentConsent` rule the rest of the feature uses, pinned against real SQL.
5. **Nest's `@Post` default answered 201 against a contract that said 200**, and nothing below the Pact tier could see it.
   The controller spec asserted 201 because that is what the handler did.
   Provider verification exists to disagree with the implementation, and it did.
6. **Linear statistics over a circular quantity are wrong in a way that looks like a real refusal.**
   Hue spread was measured with a linear interquartile range over an angle in `[0, 360)`.
   A wardrobe of magentas and pinks straddling the wrap measured 341 degrees of disagreement where the true figure is 22.
   So confidence read 0.00 where it should have read 0.75, and the derivation was refused `insufficient_wardrobe` while its colours agreed.
   Deviation from the mean direction is the correct measure.
   It is translation-invariant, so it returns the old value exactly for any non-wrapping sample, and one implementation now serves both pipelines.
7. **A seeded fixture covers only the personas it seeds.**
   `seedWardrobeItems` writes garments and `PaletteInsights` rows for the seeded teen accounts only.
   So `premium-active-user`, the account every premium end-to-end test signs in as, reached the analyze route with zero insight rows and always terminated `insufficient_wardrobe`.
   The wardrobe half of AC 2 was unreachable end to end while every unit test proving the derivation passed.
8. **A green gate suite can sit on top of a broken seed.**
   Importing `buildGarmentObjectPath` from `@couture/utils` in `seeds/commerce.ts` could not instantiate under `tsx`.
   The seed entrypoint loads a factory source first, that source `require`s the package, and Node then builds the ESM facade from the already-cached CommonJS object, so the facade carries only `default`.
   It threw before a line of seed code ran, and took down `db:reset`, all seven Maestro shards, the Playwright burn-in and the k6 smoke.
   Meanwhile lint, typecheck, `verify:changed`, every coverage ratchet, Pact and the whole integration tier were genuinely green, because Vitest resolves through its own bundler and typecheck reads `dist/index.d.ts`.
   The guard that closes it spawns a real `tsx` subprocess over a probe whose **import order** is the contract.
9. **Splitting a component for a complexity ceiling exposed its coverage gaps.**
   Extracting the consent, source, result and status blocks out of both surfaces' panels dropped no prop and no branch.
   It made visible that the write-path guards the docblocks called load-bearing were all at zero coverage: signed-out and in-progress rejections, the generic fallback line, the busy guard, the session re-read, the object-URL release, a failed mint, and a blocked popup.
10. **Test ids drift the moment two tiers describe the same behaviour.**
    Four ids were used twice across tiers, and four more were minted as literal placeholder names (`5.4-API-04x`).
    Unit-tier proofs that had been given `INT-` ids now carry `API-`/`CON-` ids; the integration tier keeps `INT-`.
    This is the same defect story 5.3's review found, in a story whose own Dev Notes warned about it.
11. **One suite's fixture is every parallel suite's data.**
    The integration suite seeded a `locale_region: '*'` garment offer, which matched and failed an unrelated 5.1 assertion running against the same database in the same parallel run.
    Isolating on a locale region no sibling queries makes a shared-database integration tier safe.
12. **A partial index's predicate is the half Prisma cannot express, so it is the half that vanishes silently.**
    The advisor lookup index carries `WHERE advisor_slot IS NOT NULL`, which lives only in hand-authored SQL.
    A regenerated migration would drop it and bring back the planner ambiguity that regressed an earlier story.
    It is now asserted directly.
13. **Declaring a mock for a native-only module resolves it.**
    Mocking `expo-web-browser` in one mobile suite made Vite resolve the specifier, which wedged the optimizer and took three unrelated suites down with an error from `expo-asset`.
    The lazy import in `src/lib/commerce.ts` exists to avoid exactly that, and a `vi.mock` defeats it.
    The load-bearing assertion, that the click is minted with the right body before any navigation, needs no mock at all.
14. **Adding one import to a screen adds it to every suite that renders the screen.**
    `settings.tsx` gained its first `expo-router` import for the advisor link row, and three suites that had never needed the module started failing on `expo-asset`'s `EventEmitter`.
15. **Put `@ts-expect-error` on the property, where TypeScript reports an excess-property error.**
    The argument object is contextually typed, so TypeScript attributes the error to the property itself.
    The directive one line higher matched nothing, which made it both a silent no-op and an "unused directive" typecheck failure.
16. **An assertion can be impossible against its own fixture.**
    Only the higher tiers could expose three such test defects.
    An end-to-end test asserted the bottom nav visible at a viewport where `min-[768px]:hidden` guarantees it is hidden.
    Another asserted an empty `<ul>` was visible, which has no bounding box.
    A mobile test gated on a synchronously-recorded key while reading the body from an awaited `request.json()`, so the gate could open with the body still undefined.
    That microtask race won six local runs and lost on the CI runner.

Story/Task mapping:

- Story 5.4
- Task 1 (Prisma enums and models, hand-authored migration with owner-only RLS, `AffiliateOffer` columns and check constraint, factories and cleanup)
- Task 2 (`@couture/utils` colour science: the `contrast.ts` refactor, then `skin-tone.ts`)
- Task 3 (Palette advisor contracts, `ADVISOR_RULES`, OpenAPI 1.3.0 to 1.4.0, three analytics events across all seven registration points)
- Task 4 (`color_analysis_enabled` registry default `true` to `false`, and its five follow-on edits)
- Task 5 (`PaletteAdvisorService` and `PaletteAdvisorController`: consent, wardrobe analysis, recommendations, erase, advisor offer resolution)
- Task 6 (Selfie lifecycle, the analysis engine, the BullMQ queue and worker registration, and the purge on all three terminal doors)
- Task 7 (Web lib, `/palette` route and panel, the bottom-nav prefix fix, ten locale catalogs, MSW component tests)
- Task 8 (Mobile lib, route, screen, settings entry row, ten locale catalogs, MSW screen tests)
- Task 9 (Pact consumer interactions and provider doubles, Playwright, the real-PostgreSQL integration suite, and the Maestro locked-state flow)
- Task 10 (`verify:changed`, coverage ratchets, repo-wide lint and typecheck, and the `deferred-work.md` ledger)

Story reference:

- `_bmad-output/implementation-artifacts/5-4-color-palette-beauty-accessory-advisor.md` (including its `Dev record` section, which lists every defect found in already-`done` work and every deliberate divergence from the plan)
- `_bmad-output/implementation-artifacts/deferred-work.md`, section "Deferred from: story 5.4 colour palette & beauty/accessory advisor (2026-08-25)"
- `architecture.md` ADR-014: the location, privacy and budget decisions this story implements, and the ONNX step it declines

Cross-links:

- Step 34 provides `PremiumEntitlementService.hasPremiumAccess` and the `PremiumEntitlementGuard` every write path here mounts.
- Step 35 provides `packages/utils/src/contrast.ts`, whose linearization this story exports and reuses, and the premium-surface, failure-classification and locale-parity conventions both surfaces follow.
- Step 33 provides the affiliate partner, offer, click-token and deep-link machinery the sponsored overlay extends by two nullable columns.
- Step 32 provides the allocate/PUT-bytes/commit photo lifecycle and the `WardrobeUploadGuard` this story mirrors and mounts unchanged.
- Step 30 provides `WardrobeColorProcessor` and the `PaletteInsights.hex_codes` rows the wardrobe source reads; without it that source has no input.
- Step 5 provides the BullMQ queue and worker registration this story adds a third queue to.
- Step 22 provides the ten-catalog localization infrastructure and the parity-spec convention the two new dedicated specs follow.
- Step 28 provides the accessibility hardening suite whose literal route list `/palette` had to be added to explicitly.

Sequence to follow:

1. Read the story's Decision 1 first.
   Four of the five subsystems this feature needs already exist, and rebuilding any of them is the main failure mode here.
2. Read `packages/utils/src/skin-tone.ts` for the sRGB to CIELAB conversion, the Individual Typology Angle and its `b* <= 0` null branch, and every named threshold constant.
   Then read `skin-tone.spec.ts` for the band boundaries pinned on both sides.
3. Read `packages/api-client/src/contracts/http/palette-advisor.ts` top to bottom.
   Its header states the four load-bearing decisions.
   `paletteAnalysisSchema` is the discriminated union that makes a ready palette with a failure reason unrepresentable.
   `ADVISOR_RULES` is the versioned rule table, and `PALETTE_ADVISOR_LOCALE_KEYS` is the copy it cannot drift from.
4. Read `packages/db/prisma/migrations/20260825090000_add_palette_advisor/migration.sql` for the two owner-only policy blocks, the `num_nonnulls` check constraint, and the partial advisor index.
5. Read `apps/api/src/modules/commerce/palette-advisor.service.ts` in this order: `hasCurrentConsent`, `getProfile`, `assertConsent` and `assertAnalysisEnabled` for the precedence, then `erase` for what revocation actually does.
6. Read `apps/api/src/modules/commerce/palette-analysis.processor.ts` for the wardrobe aggregation, the three terminal branches, and `markFailed`, the third door, called only from the worker's retry-exhaustion catch.
7. Read the advisor branch of `apps/api/src/modules/commerce/affiliate-click.service.ts` for why it keys on `offer.advisor_slot` and why the attribution id is re-resolved from the session.
8. Read `apps/web/src/lib/palette-advisor.ts` for the six-member failure-reason union and `reasonForResponse`, which separates the two different 403s by the server's own message constants.
   Then read `apps/web/src/app/components/palette-advisor-panel.tsx` and its mobile twin.

Task owner map:

- Story 5.4 Task 1 step 1 owner: define the seven enums, `PaletteProfile`, `AdvisorRecommendationState`, the `AffiliateOffer` columns and the `User` back-relations in `packages/db/prisma/schema.prisma`.
- Story 5.4 Task 1 step 2 owner: own the grants, row-level-security enablement, the two owner-only policy blocks, the `num_nonnulls` check constraint and the partial advisor index in `packages/db/prisma/migrations/20260825090000_add_palette_advisor/migration.sql`.
- Story 5.4 Task 1 step 3 owner: build and persist palette fixtures in `packages/testing/src/factories/premium.factory.ts`, registered in `packages/testing/src/factories/registry.ts` and `packages/testing/src/cleanup.ts`.
- Story 5.4 Task 2 step 1 owner: own the reusable sRGB linearization in `packages/utils/src/contrast.ts`.
- Story 5.4 Task 2 step 2 owner: own the CIELAB conversion, the Individual Typology Angle, the depth bands, the circular hue statistics and the undertone wedges in `packages/utils/src/skin-tone.ts`.
- Story 5.4 Task 3 step 1 owner: define the palette advisor HTTP contracts, `ADVISOR_RULES`, `ADVISOR_RULES_VERSION` and the locale-key enumeration in `packages/api-client/src/contracts/http/palette-advisor.ts`, registered through `packages/api-client/src/contracts/http/openapi.ts`.
- Story 5.4 Task 3 step 2 owner: register the three new events and their `.strict()` property allowlists in `packages/api-client/src/types/analytics-events.ts` and `packages/api-client/src/testing/analytics-event-assertions.ts`.
- Story 5.4 Task 3 step 3 owner: own the server-side pseudonymous emission for the three new events in `apps/api/src/modules/telemetry/telemetry.service.ts`.
- Story 5.4 Task 4 step 1 owner: own the `color_analysis_enabled` registry default in `packages/config/src/flags.ts` and its seeded `true` in `packages/db/prisma/seeds/feature-flags.ts`.
- Story 5.4 Task 5 step 1 owner: own consent, wardrobe analysis, recommendation state, offer resolution and erasure in `apps/api/src/modules/commerce/palette-advisor.service.ts`.
- Story 5.4 Task 5 step 2 owner: own the routes, the guard stacks and response parsing in `apps/api/src/modules/commerce/palette-advisor.controller.ts`, registered in `apps/api/src/modules/commerce/commerce.module.ts`.
- Story 5.4 Task 5 step 3 owner: own the advisor offer selection chain in `apps/api/src/modules/commerce/affiliate-offer.service.ts` and the advisor click branch in `apps/api/src/modules/commerce/affiliate-click.service.ts`, over the queries in `apps/api/src/modules/commerce/commerce.repository.ts`.
- Story 5.4 Task 6 step 1 owner: own the Sharp pipeline, the skin-chroma gate and the confidence terms in `apps/api/src/modules/commerce/heuristic-palette-analysis.engine.ts`, behind the interface in `apps/api/src/modules/commerce/palette-analysis.engine.ts`.
- Story 5.4 Task 6 step 2 owner: own the terminal branches, the purge and the telemetry in `apps/api/src/modules/commerce/palette-analysis.processor.ts`, enqueued through `apps/api/src/modules/commerce/palette-analysis-processing.queue.ts` and registered in `apps/api/src/config/queues.ts` and `apps/api/src/workers/wardrobe.bootstrap.ts`.
- Story 5.4 Task 7 step 1 owner: own transport and failure classification in `apps/web/src/lib/palette-advisor.ts`, and the affiliate click mint in `apps/web/src/lib/commerce.ts`.
- Story 5.4 Task 7 step 2 owner: own the consent, source, status, result and card states in `apps/web/src/app/components/palette-advisor-panel.tsx`, mounted from `apps/web/src/app/palette/page.tsx`.
- Story 5.4 Task 7 step 3 owner: own the longest-prefix active-tab resolution in `apps/web/src/app/components/sticky-bottom-nav.tsx`.
- Story 5.4 Task 8 step 1 owner: own transport and failure classification in `apps/mobile/src/lib/palette-advisor.ts`.
- Story 5.4 Task 8 step 2 owner: own the screen states and the `expo-image-picker` capture in `apps/mobile/src/features/premium/palette-advisor-screen.tsx`, reached from the thin route `apps/mobile/app/palette-advisor.tsx` and the link row in `apps/mobile/app/(tabs)/settings.tsx`.
- Story 5.4 Task 7/8 step 4 owner: own the `commerce.premium.palette.*` subtree across the ten catalogs in `apps/web/src/i18n/locales/` and `apps/mobile/assets/locales/`.

Tests that cover this step:

Shared utility unit tests:

- [`packages/utils/src/skin-tone.spec.ts`](../../packages/utils/src/skin-tone.spec.ts): pins every ITA° band boundary on both sides (`5.4-UTIL-020`), the `b* <= 0` null branch, a known-hex round trip through `srgbToLab`, `#RGB` acceptance and `#RRGGBBAA` rejection, the olive hue wedge, negative-`a*` inputs a ratio implementation would misclassify, and the circular hue spread that a linear interquartile range gets wrong across the 0/360 wrap (`5.4-UTIL-050` through `5.4-UTIL-054`).
  Floating-point results use `toBeCloseTo(value, 2)`.
  Exact `toBe` equality cannot provide that tolerance.

Contract and analytics unit tests:

- [`packages/api-client/testing/palette-advisor-contract.spec.ts`](../../packages/api-client/testing/palette-advisor-contract.spec.ts): proves the rule table is deterministic and frozen (`5.4-CON-031`), that the status union makes a ready palette with a failure reason unrepresentable, and that every `swatchHex` clears `meetsWcagAA()` against the card background it renders on at SC 1.4.11's non-text floor (`5.4-CON-030`).
- [`packages/api-client/testing/palette-advisor-analytics.spec.ts`](../../packages/api-client/testing/palette-advisor-analytics.spec.ts): proves set-equality across all three analytics registries, ships a negative fixture per event proving the `.strict()` allowlist rejects anything beyond the named properties, and proves a raw user id is never accepted in place of the pseudonymous subject (`5.4-CON-020` through `5.4-CON-022`).

Real-PostgreSQL database tests:

- [`packages/db/test/palette-advisor-schema.spec.ts`](../../packages/db/test/palette-advisor-schema.spec.ts): pins `authenticated` to exactly the four owner verbs and `anon` to none, the four policy names per table, the nullable/unique/cascade shape, the check constraint rejecting both-null and both-set `AffiliateOffer` rows (`5.4-DB-001` through `5.4-DB-008`), and the advisor index staying PARTIAL on `advisor_slot IS NOT NULL` (`5.4-DB-041`).
- [`packages/db/test/seed-graph-instantiation.spec.ts`](../../packages/db/test/seed-graph-instantiation.spec.ts): spawns a real `tsx` subprocess over a probe whose IMPORT ORDER is the contract, which is the only tier that can see a seed module failing to instantiate (`5.4-DB-040`).
  Vitest resolves workspace packages through its own bundler, so no other suite in the repository could have caught it.
- [`packages/db/test/rls/palette-advisor.spec.ts`](../../packages/db/test/rls/palette-advisor.spec.ts): runs the full owner-only actor matrix over both new tables (`5.4-DB-020` through `5.4-DB-030`), including the INSERT policy's positive half, driven through the `authenticated` role because the admin pool bypasses row-level security.

API unit tests:

- [`apps/api/src/modules/commerce/palette-advisor.service.spec.ts`](../../apps/api/src/modules/commerce/palette-advisor.service.spec.ts): proves consent is checked before the flag (`5.4-API-010`, `5.4-API-011`), the kill switch is observable only by an entitled consented caller (`5.4-API-061`), dismissed cards are omitted from the next read (`5.4-API-050`), and the full selfie allocate/commit idempotency and compensating-release behaviour.
- [`apps/api/src/modules/commerce/palette-advisor.controller.spec.ts`](../../apps/api/src/modules/commerce/palette-advisor.controller.spec.ts): proves the guard stack over HTTP, the consent-before-flag precedence (`5.4-API-012`, `5.4-API-060`, `5.4-API-062`), the inherited `Cache-Control: private, no-store`, and that `DELETE` stays reachable for a lapsed subscriber.
- [`apps/api/src/modules/commerce/palette-analysis.processor.spec.ts`](../../apps/api/src/modules/commerce/palette-analysis.processor.spec.ts): proves the wardrobe classification is deterministic with `depth: null` (`5.4-API-021`), the sample and confidence floors (`5.4-API-022` through `5.4-API-026`), every engine outcome terminating and purging (`5.4-API-033` through `5.4-API-036`), and that a failed purge cannot strand `processing`.
- [`apps/api/src/modules/commerce/heuristic-palette-analysis.engine.spec.ts`](../../apps/api/src/modules/commerce/heuristic-palette-analysis.engine.spec.ts): proves `no_face` below the skin-pixel floor (`5.4-API-032`), a framed face classifying ready (`5.4-API-031`), and determinism across repeated runs.
- [`apps/api/src/modules/commerce/affiliate-click.service.spec.ts`](../../apps/api/src/modules/commerce/affiliate-click.service.spec.ts): proves the advisor branch keys on the offer row, with the client-supplied surface crossed in both directions (`5.4-INT-022`, `5.4-INT-023`), and that the attribution id is derived server-side (`5.4-INT-024`, `5.4-INT-025`) while the garment path is unchanged (`5.4-INT-026`).
- [`apps/api/src/modules/commerce/affiliate-offer.service.spec.ts`](../../apps/api/src/modules/commerce/affiliate-offer.service.spec.ts): proves the advisor selection runs the same short-circuit chain as `resolveShopThisLook`, degrades to no offer on a catalog fault, and never calls the other selection's query in either direction (`5.4-API-040` through `5.4-API-045`).

Real-PostgreSQL API integration tests:

- [`apps/api/integration/palette-advisor.integration.spec.ts`](../../apps/api/integration/palette-advisor.integration.spec.ts): proves an immutable `AuditLog` row on both the grant and the revoke (`5.4-INT-001`), that revocation erases the derived scalars while keeping the row (`5.4-INT-002`), the selfie purge on all three terminal doors (`5.4-INT-011` through `5.4-INT-013`), that the two selections cannot cross against real SQL (`5.4-INT-020`, `5.4-INT-021`), the commerce opt-out suppressing the overlay (`5.4-INT-027`), owner-scoped erasure (`5.4-INT-028`), and consent-scoped advisor attribution (`5.4-INT-029`).
  This entry was corrected on 2026-09-05; it used to say no workflow runs the integration tier.
  `apps/api/vitest.config.ts` includes `integration/**/*.spec.ts`, so `pr-checks.yml`'s `quality-gate` job runs this suite inside its `test:coverage` step against its own PostgreSQL service.
  The `test:integration` script itself is what no workflow calls.

Web unit and component tests:

- [`apps/web/src/lib/palette-advisor.test.ts`](../../apps/web/src/lib/palette-advisor.test.ts): proves the two different 403s are separated by the server's own message constants, the 409 and 503 classifications, that an unrecognised 403 falls back to the locked panel so the user is not invited into a consent grant the server would reject, and that one idempotency key covers allocate and commit (`5.4-WEB-001` through `5.4-WEB-009`).
- [`apps/web/src/app/components/palette-advisor-panel.test.tsx`](../../apps/web/src/app/components/palette-advisor-panel.test.tsx): drives every state through MSW with the real lib, including the three states reachable only by a rejected write (`5.4-WEB-027` through `5.4-WEB-029`), the sponsored disclosure preceding its control by document position (`5.4-WEB-022`), and an axe scan of the ready state with a sponsored card (`5.4-WEB-033`).
- [`apps/web/src/app/components/sticky-bottom-nav.test.tsx`](../../apps/web/src/app/components/sticky-bottom-nav.test.tsx): proves the longest-prefix active-tab resolution, including `/wardrobe/capsules` resolving to Wardrobe and `/palette` resolving to no tab at all (`5.4-WEB-030` through `5.4-WEB-032`).
- [`apps/web/src/i18n/palette-advisor-locales.spec.ts`](../../apps/web/src/i18n/palette-advisor-locales.spec.ts): derives its key set from the contract, so a shade added to `ADVISOR_RULES` fails here until all ten catalogs carry its label (`5.4-I18N-WEB-01` through `5.4-I18N-WEB-09`), and asserts the `en-CA` spellings in both directions.

Mobile unit and screen tests:

- [`apps/mobile/src/screens/palette-advisor-screen.test.tsx`](../../apps/mobile/src/screens/palette-advisor-screen.test.tsx): drives the consent gate, both sources, the full selfie allocate/bytes/commit lifecycle on one idempotency key, dismissed-item suppression, the locked state, and a stale `analysis_version` rendering without a crash (`5.4-MOB-010` through `5.4-MOB-026`).
- [`apps/mobile/src/i18n/palette-advisor-locales.spec.ts`](../../apps/mobile/src/i18n/palette-advisor-locales.spec.ts): proves the mobile half of the same contract-derived parity check (`5.4-I18N-MOB-01` through `5.4-I18N-MOB-09`).

Contract (Pact) tests:

- [`pact/http/consumer/interactions/commerce-palette-advisor.ts`](../../pact/http/consumer/interactions/commerce-palette-advisor.ts): records the profile read for entitled and non-entitled callers, the consent grant, the `202` wardrobe analyze, the dismissal, and the three-row error table.
  That table exists to show that two different 403s carry two different messages that both clients branch on.

End-to-end tests:

- [`playwright/tests/palette-advisor.spec.ts`](../../playwright/tests/palette-advisor.spec.ts): runs the entitled journey for real against the seeded subscriber with the worker live: consent, wardrobe derivation, save, dismiss, reload (`5.4-E2E-010`).
  It also covers the signed-out locked state and axe at both viewports (`5.4-E2E-011`), the signed-in non-entitled locked panel (`5.4-E2E-013`), and the retired `analysis_version` fallback (`5.4-E2E-012`).
- [`maestro/palette-advisor.yaml`](../../maestro/palette-advisor.yaml): proves the settings entry row and the locked state for the harness's fresh signed-up user.
  Its docblock states the scope: the entitled advisor and the `expo-image-picker` capture are out of a Maestro run's reach.

Evidence boundaries:

- Real-world classification accuracy against human skin is not tested.
  This story asserts determinism and band boundaries only.
  An accuracy study needs labelled data this project does not have.
- The skin-pixel gate is exercised against fixture images only.
  The Chai-Ngan bounds are illumination-tolerant.
  Classification can still change with illumination.
  A heavily warm-lit or filtered selfie is expected to fail `no_face` or `low_quality` and return no answer; that expectation is asserted against fixtures only.
- `expo-image-picker`'s native camera path is mocked in unit tests and reached by no automated tier.
- The advisor offer lookup has no query-plan coverage: the plan suite's 4,000 volume rows are all garment offers, so no advisor row exists at volume for a plan to measure.

Architecture diagram:

```mermaid
flowchart TD
  subgraph Sources
    SELFIE["selfie\nallocate / PUT bytes / commit"]
    WARDROBE["wardrobe\nPaletteInsights.hex_codes\nwritten by Step 30"]
  end

  SELFIE --> CONSENT
  WARDROBE --> CONSENT
  CONSENT{"PaletteProfile\nconsent_granted_at / consent_revoked_at\nserver-enforced on every path"} -- "absent" --> F403C["403 PALETTE_CONSENT_REQUIRED"]
  CONSENT -- "current" --> FLAG{"color_analysis_enabled\ndefault false, true only in the seed"}
  FLAG -- "off" --> F503["503 PALETTE_ANALYSIS_DISABLED\nonly an entitled consented caller sees this"]
  FLAG -- "on" --> QUEUE["palette-analysis queue\njob id = profile id + upload session id"]

  QUEUE --> PROC["PaletteAnalysisProcessor"]
  PROC -- "wardrobe" --> AGG["median a*/b* of chromatic survivors\nlinearize BEFORE averaging\ndepth: null"]
  PROC -- "selfie" --> ENGINE["Sharp: rotate, 256x256 cover,\ncentre crop, Chai-Ngan YCbCr gate\non gamma-encoded bytes"]
  ENGINE --> LAB["linearRgbToLab on survivors\nmedian a*/b*"]
  AGG --> CLASS
  LAB --> CLASS["skin-tone.ts\nITA° -> depth, atan2 hue -> undertone\ncircular hue spread -> confidence"]
  CLASS -- "confidence below 0.4" --> FAIL
  CLASS --> READY["status ready\nundertone, depth, confidence, analysis_version"]

  READY --> PURGE
  FAIL["status failed\nfailure_reason"] --> PURGE
  MARK["worker catch, final attempt only\nmarkFailed: timeout or storage_error"] --> PURGE
  PURGE["purgeSelfie\nstatus commits FIRST, purge is best-effort\nselfie_purged_at stamped"]

  READY --> RULES["ADVISOR_RULES\nversioned, deterministic, itemKey is the identity\nlabelKey is a locale key, never English"]
  RULES --> CARDS["five slots\nsaved / dismissed in AdvisorRecommendationState\ndismissed omitted from the next GET"]
  CARDS --> OFFER{"commerce_affiliate_enabled\nthen affiliate_ctas_enabled\nthen findBestAdvisorOffer"}
  OFFER -- "any fault" --> NOOFFER["no offer\nfirst-party recommendation renders alone"]
  OFFER --> SPONSORED["sponsored block\ndisclosure BEFORE the control"]
  SPONSORED -- "click" --> CLICK["AffiliateClickService\nbranches on offer.advisor_slot, never input.surface\nrecommendation_id re-resolved from the session"]

  ERASE["DELETE /palette\nno entitlement guard, by design"] --> WIPE["nulls the scalars, keeps the row,\ndeletes every AdvisorRecommendationState,\npurges any retained object, writes AuditLog"]
  REVOKE["POST /consent, granted false"] --> WIPE
```

## Step 37: Premium 7-day outfit planner

User/business impact:

Shows a paying subscriber the week ahead.
On web, the Lookbook home has a "Plan week" control that opens `PlannerRail` as the inline third column at 1440px and wider, and as a focus-trapped drawer below that width.
On mobile, a Premium settings row opens the `/planner` route.
Both surfaces render seven consecutive local dates.
Each date has a `morning`, `midday` and `evening` outfit built from the reader's own garments and capsules, and each ready date has one reshuffle control that regenerates that date alone.

Two properties carry the feature.
The first is honest degradation.
A date with exact 08:00, 13:00 and 19:00 hourly segments is labelled `hourly`.
A date covered only by the provider's daily summary is labelled `daily` and says its reasoning came from the day's summary forecast.
A date with no usable weather renders a wardrobe and comfort-preference baseline labelled `unavailable`, with no temperature, condition or freshness badge.
The second is failure isolation: the wire contract makes each of the seven dates `ready` or `error` on its own, so one failed date leaves the other six readable and retryable.

Key takeaways:

1. **Extract the generation core; leave caching and persistence with the caller.**
   `RitualService.getOrCreateRitual` mixed location resolution, date selection, Redis and database caching, weather selection, garment loading, capsule scoring, generation and presentation.
   Task 2 lifts the pure part into `apps/api/src/modules/personalization/ritual-generation.engine.ts`, which owns no Prisma, no Redis and no HTTP.
   `ritual.service.spec.ts` passing with zero assertion changes across its 50 tests proves the extraction kept behaviour.
2. **Calling the per-day endpoint seven times was the option turned down, and the story records why.**
   `getOrCreateRitual`'s Redis key and its `OutfitRecommendation` persistence identity both stand for one ritual date and one forecast segment.
   Seven calls would have written seven ritual rows for dates the user never asked the ritual surface about.
   The planner calls the engine directly and owns its own `PlannerDayPlan` cache row.
3. **Do calendar arithmetic on validated date-only strings in UTC parts.**
   `parseLocalDateParts` rejects anything that is not a real calendar date by round-tripping through `Date.UTC`.
   `resolvePlannerDateWindow` adds the day offsets in UTC parts.
   `toDatabaseDate` stores the local calendar label as UTC midnight for the Prisma `@db.Date` column.
   A local `Date` constructor anywhere on that path can skip or duplicate a date across a daylight-saving transition.
   Both clients format `planDate` back out through an explicit `timeZone: 'UTC'` formatter for the same reason.
4. **Persist badges in one canonical language and localize at the boundary.**
   The engine returns English canonical `reasoningBadges`, because `RitualService` persists them into `OutfitRecommendation.reasoning_badges`.
   A later read in a different locale re-localizes them through `mapRawBadgeToCanonical`, keyed on the badge's canonical key.
   `comfortNotes` are recomputed every request, so the engine returns those already localized.
   The planner persists both, calling `mapRawBadgeToCanonical` once at generation time.
   That is why locale is part of the dependency fingerprint: a locale change has to force a regenerate.
5. **One SHA-256 fingerprint over canonical sorted inputs is the whole invalidation story.**
   `computeDependencyFingerprint` hashes the location id, the weather snapshot revision (`fetched_at`), the three comfort preferences, the locale, `id:updated_at` for every eligible garment and capsule, and the profile's `capsule_revision`.
   Every input is request-scoped, so all seven of a user's rows carrying the same fingerprint is the expected state.
6. **A fingerprint hit still needs an ownership check.**
   Even when the fingerprint matches, `payloadReferencesOnlyEligibleIds` re-checks every real garment and capsule id in the stored payload against the eligible sets loaded this request.
   A deleted or newly ineligible garment cannot reach a returned plan.
   Placeholder ids (`default-<category>`) are skipped by prefix.
7. **Regenerate in place.**
   An existing row goes through `update` by id, which has no unique-constraint race.
   Only a missing row goes through `create` with `P2002` recovery, where the loser of a cold-read race re-reads and returns the persisted winner.
   Delete-then-create was rejected because a request that died between the two statements would leave a date with no row.
8. **Optimistic concurrency fits in one statement.**
   Reshuffle issues `updateMany({ where: { id, version: expectedVersion }, data: { version: { increment: 1 } } })`, and `count === 0` is the documented `409 PLANNER_DAY_CHANGED_MESSAGE`.
   PostgreSQL re-evaluates the predicate for each concurrent writer, so this needs no surrounding transaction.
9. **`unchanged` is a measured fact about the payload.**
   `payloadsEquivalent` compares the three scenarios' sorted garment sets and capsule ids, which matches AC 4's wording exactly.
   Reshuffle's exclusion list is a soft preference.
   `selectGenericGarments` drops the exclusion for a category whose only eligible candidate is excluded.
   That keeps a real garment on a thin wardrobe and makes `unchanged: true` the honest answer for that date.
   A `default-<category>` placeholder stays reserved for a category with zero eligible garments.
10. **Extend the weather contract additively.**
    `WeatherSnapshot.daily_summaries` is a nullable JSONB column parsed by the canonical Zod schema on every read.
    `parseDailySummaries` discards and logs a malformed entry and returns the rest.
    The 48-hour contiguous hourly contract, `ForecastSegment`, the refresh cadence, failover, freshness and the alert path all keep their behaviour.
    OpenWeather drops `daily` from its `exclude` parameter and keeps `minutely` excluded.
    WeatherAPI gains `WEATHERAPI_FORECAST_DAYS`, a coerced integer from 1 through 8 defaulting to 3, because forecast depth there depends on the plan.
11. **Three weather tiers, each labelled for what it is.**
    Hourly uses the exact 08:00, 13:00 and 19:00 segments.
    The daily projection maps morning to the minimum, midday to the maximum and evening to the midpoint, preferring the provider's feels-like bounds.
    `withEvidenceSuffix` appends "(from the day's summary forecast)" to every bullet the daily projection produces.
    The unavailable branch returns `freshness: null`, `condition: null` and both temperatures null, so a baseline day cannot show precision it lacks.
12. **The calling platform is a declared contract header.**
    Both operations require `x-couture-platform: web | mobile` as a declared header, so `premium_planner_viewed` and `premium_planner_day_reshuffled` carry a server-read `platform` property.
    The controller rejects a missing or unknown value with `400` before the handler runs.
13. **A path prefix can carry middleware across a module boundary.**
    `PlannerController` lives in `PersonalizationModule`, next to the generation engine and the weather, comfort and wardrobe reads.
    It keeps the `api/v1/commerce/premium/planner` path, so it still inherits `CommerceCacheHeadersMiddleware`'s `Cache-Control: private, no-store`.
    The middleware is registered by path pattern, so controller ownership does not matter.
    The controller's header comment records the decision.
14. **One request settles entitlement and data.**
    The planner `GET` itself returns `401`, `403 PREMIUM_REQUIRED_MESSAGE` and `503 PREMIUM_PLANNER_DISABLED_MESSAGE`.
    `plannerFailureReason` classifies all three into a reason the UI maps onto a `commerce.premium.planner.*` key, so neither surface needs a separate subscription pre-check to keep in sync.
    No English server message reaches a reader, and a rail nobody opened fires no request.
15. **Two 403s that mean different things need separating at the client.**
    `reasonForResponse` reads the contract's own `PREMIUM_REQUIRED_MESSAGE` constant to tell "subscribe" apart from `location_not_owned`.
    `location_not_owned` is an internal-state mismatch a reader cannot fix by clicking anything on the card.
    `PremiumEntitlementGuard` runs before the handler and always sends the former, so any other 403 text falls back to the latter.
16. **`@HttpCode(200)` on the reshuffle POST, written before Pact could find it.**
    Step 36's provider verification caught Nest's `@Post` default answering 201 against a contract that said 200.
    Story 5.5 declares the code on the handler from the first commit.

Hard-won lessons from the implementation and code review of this story:

1. **A jsdom axe pass says nothing about real contrast, and it missed two colours on the same component.**
   The scenario label (`Morning`, `Midday`, `Evening`) took its text colour from `--theme-secondary`, a decorative accent the same file uses as a button background and a focus outline.
   It measured 2.41:1 against the card's white background in all four premium themes.
   The unavailable-weather note took `text-neutral-500` against `--theme-card-bg` and measured 4.35:1.
   WCAG's small-text floor is 4.5:1.
   The component-level axe test passed both; the real-browser Playwright scan caught both, the second one through `5.5-E2E-02`.
   Both now use `--theme-card-text`, the token this codebase pairs with `--theme-card-bg`, at 8:1 or better in every theme.
2. **A spec counts as evidence only once it has run.**
   Task 7's own edit to `playwright/tests/accessibility-hardening.spec.ts` opened the planner before the reduced-motion assertions.
   That left Chromium's `:focus-visible` heuristic in its pointer-interaction state for a script-triggered `.focus()` further down the same test, and `outlineStyle` came back `'none'` under forced-colors.
   One real `Tab` keypress before that focus resets the heuristic, the way a keyboard user reaching the element would.
   The failure appeared the first time the file ran.
3. **A component's own render happens before the `I18nextProvider` it returns.**
   `lookbook-prism-layout.tsx` had no provider, since `/` never had one.
   Adding one for the planner slots gives it to descendants only, so the file's own top-level copy reads `getI18n().t(...)` directly.
4. **Decide the responsive variant in JavaScript when only one instance may mount.**
   CSS alone would render both the inline rail and the overlay drawer and let each fire its own planner `GET`.
   `LookbookPrismLayout` reads `window.innerWidth` at the 1440px boundary, matching this file's existing PostHog viewport reporting, so exactly one `PlannerRail` mounts.
5. **A worktree missing `prisma generate` reports as code debt.**
   A reported blocker of "133 pre-existing lint errors" in `playwright/support/helpers/{guardian-consent,user-test-data}.ts` reproduced exactly, all `@typescript-eslint/no-unsafe-*` on `PrismaClient` model delegates.
   The generated client had never been built in that worktree, so every delegate property fell back to `any`.
   One `npx prisma generate` cleared all 133.
   `packages/api-client` needed the same treatment before `apps/mobile`'s bare `lint` script resolved its `./testing/*` subpath.
6. **A registry size assertion breaks on the next key.**
   `feature-flags.service.spec.ts` hardcoded the flag registry's count at 6 and the exact `upsertMany` payload; `premium_planner_enabled` made the true size 7.
   Both assertions were updated in the same change that added the flag.
7. **Cover every fingerprint input, one test each.**
   The pre-PR test-architecture review found `planner.service.spec.ts` testing invalidation for the wardrobe input alone, while AC 9 names five.
   Four unit tests were added, one per remaining input (weather snapshot revision, comfort preferences, locale, capsule content), each changing exactly one dependency and asserting all seven days regenerate.
   All four passed against the existing implementation with no production change.
   They exist to catch a future edit to any of those call sites that would otherwise regress silently.
8. **Provider verification timeouts have to grow with the interaction count.**
   Fourteen new planner interactions took the suite to 175.
   A clean run was already at 48 seconds of the old 60-second budget, so the provider config moved to 180 seconds with a 60-second hook timeout.
9. **Running the full integration suite surfaces its neighbours' flakes.**
   `wardrobe-silhouette.integration.spec.ts`'s `4.4-INT-15` had a BullMQ round-trip timeout too tight for real CPU and IO contention once a thirtieth file joined the suite.
   It was fixed in this story's change.
10. **Maestro's text matcher wants the whole localized sentence.**
    The flow's intro assertion was written against a truncated prefix of the copy and failed on its first real run against an iOS Simulator.
    Every other flow in the repository already matches the full string.
11. **`.nullable()` on a shared enum schema mutates that schema for every other contract.**
    `planner.ts` first wrote `condition: weatherConditionSchema.nullable()`.
    `openapi.ts`'s `preserveNullableEnumValues` post-pass appends `null` into the array the schema hands it, and that array is `weatherConditionSchema`'s own `_def.values` by reference.
    So `null` appeared in the condition enum of the untouched `GET /api/v1/ritual` and `GET /api/v1/weather/{locationKey}` responses, and Optic failed the PR on a breaking change to two endpoints this story never edited.
    `nullableWeatherConditionSchema` publishes a finished enum array of its own, the workaround story 5.3's `nullablePremiumThemeKeySchema` documented when it first hit this.
12. **A lazy `useState` initializer that reads `window` is a hydration bug.**
    `LookbookPrismLayout` seeded `isNarrowViewport` from `window.innerWidth`.
    The server has no `window` and resolved `false`, while the client's first hydration render read the real width.
    A narrow viewport therefore disagreed with the server's markup and threw React error #418 on `/` during the PR burn-in.
    The fix initializes to `false` and corrects the value inside the existing resize effect's mount run, one render after hydration.
    `home-analytics-capture.spec.ts` reproduced the error against a real stack before the fix and passed after it.
13. **A coverage gate measures the whole workspace, so it fails on code the story never touched.**
    `packages/api-client` fell to 98.37% functions against a 99% threshold, `apps/web` to 94.5% statements and 87.21% branches against 95% and 89%, and `apps/mobile` to 91.77% and 86.08% against 92% and 87%.
    Closing those gates produced three new network-boundary unit specs driven through MSW, extended two from earlier stories, and deleted one dead branch.
    `resolveAcceptLanguage`'s `.split('=')[1] ?? ''` fallback could never execute, because a parameter reaches that line only after matching `startsWith('q=')`, which guarantees the `=`.
    `.slice(2)` off the pre-trimmed match types as a plain string and leaves no unreachable branch.
14. **The Pact consumer flake is a mock-server race, and a retry now bounds it.**
    Story 5.4 recorded the symptom and could not reproduce it: "The following request was expected but not received", on a different unrelated interaction each time, clean across 37 local runs.
    Saturating 12 of 14 local cores turned it into a roughly 33% per-run failure.
    That identified a PactV4 FFI teardown-and-startup overlap as the cause and cleared every individual interaction.
    `pact/http/vitest.consumer.config.mts` now has a bounded retry, and story 5.4's deferred entry keeps the open question of an explicit per-interaction port.
15. **Expo Go's developer sheet is drawn outside the hierarchy Maestro queries.**
    Android shard 3 failed with `id: wardrobe-screen is visible` false while `tab-wardrobe` reported COMPLETED on all four retries.
    The hierarchy dump showed Home still on top, and the screenshot showed the sheet covering the tab bar.
    `open-app.yaml` had already handled this with a blind coordinate tap on the sheet's backdrop.
    This story's larger bundle (1903 modules, about 22 seconds) pushed the sheet's rise past that absorb window and into the tab subflows'.
    The sequence now lives in `maestro/subflows/absorb-expo-dev-sheet.yaml`, called from both `open-wardrobe-tab.yaml` and `open-settings.yaml`, which also closes the `open-settings.yaml` flake story 5.4 recorded.

Story/Task mapping:

- Story 5.5
- Task 1 (Daily weather ingestion: provider and normalized daily schemas, OpenWeather and WeatherAPI mapping, `WeatherSnapshot.daily_summaries` and its guarded read)
- Task 2 (`ritual-generation.engine.ts`: the pure generation core, the date helpers, the hourly/daily/unavailable adapters and the exclusion behaviour)
- Task 3 (`PlannerOutfitSource`, `PlannerDayPlan`, the owner-only migration, the `SavedLocation` composite unique key, factories and cleanup)
- Task 4 (`planner.ts` HTTP contract, its exact collection invariants, OpenAPI 1.4.0 to 1.5.0, and the regenerated client)
- Task 5 (`premium_planner_enabled` across all four flag touchpoints, and both analytics events across the seven registration points)
- Task 6 (`PlannerService` and `PlannerController`: window resolution, fingerprinting, per-day generation, pruning, batched garment enrichment and versioned reshuffle)
- Task 7 (Web: `lib/planner.ts`, the live `PlannerRail`, the Plan week control and the rail/overlay variant decision, ten locale catalogs)
- Task 8 (Mobile: `lib/planner.ts`, the planner screen, the thin route, the settings link row, ten locale catalogs)
- Task 9 (Locale parity specs on both surfaces, and the web axe matrix over both variants crossed with both entitlement states)
- Task 10 (Pact interactions and provider doubles, the real-PostgreSQL integration suite, Playwright, the Maestro locked-state flow, and the `deferred-work.md` ledger)

Story reference:

- `_bmad-output/implementation-artifacts/5-5-premium-7-day-outfit-planner.md` (including its `Dev Agent Record`, which has the pre-PR test-architecture review and every deliberate divergence from the plan)
- `_bmad-output/implementation-artifacts/deferred-work.md`, section "Deferred from: story 5.5 premium 7-day outfit planner (2026-09-04)"
- `_bmad-output/planning-artifacts/epics.md:456-463` for the epic's own wording, which the story's scenario summary resolves into three scenarios per day

Cross-links:

- Step 19 provides the scenario generator this story extracts its engine from, along with the comfort thresholds, capsule scoring and starter-wardrobe fallback the engine keeps verbatim.
- Step 20 provides the comfort preferences that feed both the generation and the dependency fingerprint.
- Step 21 provides the reasoning badges whose canonical-key localization the engine preserves.
- Step 16 provides the weather providers, `WeatherSnapshot`, `ForecastSegment` and the freshness union this story extends by one nullable column.
- Step 31 provides the outfit capsules and the `capsule_revision` counter the fingerprint reads.
- Step 34 provides `PremiumEntitlementGuard`, whose `PREMIUM_REQUIRED_MESSAGE` both clients branch on, and the static planner shell this story replaces.
- Step 35 provides the semantic premium theme tokens both surfaces consume and `useAppTheme()` on mobile.
- Step 36 provides the architecture both surfaces copy: the self-contained premium panel, the classified failure reason, the ten-catalog subtree with a dedicated parity spec, the owner-only RLS migration this one mirrors policy-for-policy, and the settings link row pattern.
- Step 25 provides `LookbookPrismLayout` and the third-column rail slot the planner occupies at 1440px and wider.
- Step 28 provides the accessibility hardening suite whose reduced-motion and focus-contrast tests this story had to open the planner inside.
- Step 22 provides the ten-catalog localization infrastructure and the parity spec convention both new specs follow.
- Steps 14 and 15 provide the Zod-first contract authoring, the OpenAPI registry and the generation pipeline `planner.ts` registers through.

Sequence to follow:

1. Read the story's Decision 1 and Decision 4 first.
   They set what the planner owns (a disposable per-date cache row) and what it borrows (the ritual generation core, unchanged).
2. Read the header comment of [`apps/api/src/modules/personalization/ritual-generation.engine.ts`](../../apps/api/src/modules/personalization/ritual-generation.engine.ts) for the badge-versus-comfort-note localization split.
   Then read `resolveRitualAnchorDate`, `parseLocalDateParts`, `resolvePlannerDateWindow` and `toDatabaseDate` as one block; those four are the whole date story.
3. Read `dailyProjectionToScenarioInputs` and `withEvidenceSuffix` in the same file for how a daily summary becomes three scenarios and how it labels itself, then `selectGenericGarments` for the soft-exclusion fallback.
4. Read [`packages/api-client/src/contracts/http/planner.ts`](../../packages/api-client/src/contracts/http/planner.ts) top to bottom.
   `plannerLocalDateSchema` validates real calendar dates.
   The days collection pins `.min(7).max(7)` plus uniqueness, consecutiveness and chronological order.
   `plannerScenarioOutfitSchema` constrains `shopThisLook` to `null`.
5. Read [`packages/db/prisma/migrations/20260904091500_add_planner_day_plan/migration.sql`](../../packages/db/prisma/migrations/20260904091500_add_planner_day_plan/migration.sql) for the four owner-only policies, the `(user_id, location_id, plan_date)` unique key, and the composite foreign key to `SavedLocation(id, user_id)` that makes a cross-user location reference structurally impossible.
6. Read [`apps/api/src/modules/personalization/planner.service.ts`](../../apps/api/src/modules/personalization/planner.service.ts) in this order: `computeDependencyFingerprint`, then `resolveOneDay` for the fingerprint hit, the eligibility re-check and the per-date try/catch, then `persistGeneratedDay` for the `P2002` cold-read recovery, then `reshuffleDay` for the version-gated `updateMany` and `payloadsEquivalent`.
7. Read [`apps/web/src/lib/planner.ts`](../../apps/web/src/lib/planner.ts) for `reasonForResponse` and the temperature and date formatters.
   Then read [`apps/web/src/app/components/planner-rail.tsx`](../../apps/web/src/app/components/planner-rail.tsx) for the `checking | entitled | locked | error` state machine and the two variants' focus behaviour.
8. Read [`apps/mobile/src/features/premium/planner-screen.tsx`](../../apps/mobile/src/features/premium/planner-screen.tsx) beside it.
   The two surfaces classify the same statuses into the same reason enum and both abort in-flight requests, so reading them together makes cross-surface drift visible.

Task owner map:

- Story 5.5 Task 1 step 1 owner: own the daily provider and normalized schemas in `apps/api/src/modules/weather/providers/weather.schemas.ts` and `weather.types.ts`, and the local-date helper in `apps/api/src/modules/weather/providers/weather-date.util.ts`.
- Story 5.5 Task 1 step 2 owner: own the OpenWeather daily mapping and the `exclude` parameter in `apps/api/src/modules/weather/providers/openweather.provider.ts`, and the WeatherAPI depth config `WEATHERAPI_FORECAST_DAYS` in `apps/api/src/modules/weather/providers/weather.config.ts` with its mapping in `weatherapi.provider.ts`.
- Story 5.5 Task 1 step 3 owner: own `daily_summaries` serialization and the guarded `parseDailySummaries` reader in `apps/api/src/modules/weather/weather.repository.ts`, over the column added by the migration `packages/db/prisma/migrations/20260904090000_add_weather_daily_summaries/`.
- Story 5.5 Task 2 step 1 owner: own the date helpers, the comfort thresholds, the badge and comfort-note localization tables, the exclusion behaviour and `generateRitualScenarios` in `apps/api/src/modules/personalization/ritual-generation.engine.ts`.
- Story 5.5 Task 2 step 2 owner: own the delegation from `apps/api/src/modules/personalization/ritual.service.ts` to the engine, preserving its Redis keys, persistence and analytics behaviour.
- Story 5.5 Task 3 step 1 owner: own `PlannerOutfitSource`, `PlannerDayPlan`, the `SavedLocation` composite unique key and the back-relations in `packages/db/prisma/schema.prisma`.
- Story 5.5 Task 3 step 2 owner: own the grants, row-level-security enablement and the four owner-only policies in `packages/db/prisma/migrations/20260904091500_add_planner_day_plan/migration.sql`.
- Story 5.5 Task 3 step 3 owner: own the planner fixture in `packages/testing/src/factories/planner.factory.ts`, registered through `packages/testing/src/factories/registry.ts`, `packages/testing/src/factories/index.ts` and `packages/testing/src/cleanup.ts`.
- Story 5.5 Task 4 step 1 owner: define the planner HTTP contracts, the header schema, the collection invariants and the message constants in `packages/api-client/src/contracts/http/planner.ts`, registered through `packages/api-client/src/contracts/http/index.ts` and `packages/api-client/src/contracts/http/openapi.ts`, and bridged into the API through `apps/api/src/contracts/http.ts`.
- Story 5.5 Task 5 step 1 owner: own the `premium_planner_enabled` registry entry in `packages/config/src/flags.ts` and its seeded `true` in `packages/db/prisma/seeds/feature-flags.ts`.
- Story 5.5 Task 5 step 2 owner: own both planner events in `packages/api-client/src/types/analytics-events.ts` and `packages/api-client/src/testing/analytics-event-assertions.ts`, and their pseudonymous server-side emission in `apps/api/src/modules/telemetry/telemetry.service.ts`.
- Story 5.5 Task 6 step 1 owner: own location and locale resolution, fingerprinting, per-day resolution, pruning, enrichment and versioned reshuffle in `apps/api/src/modules/personalization/planner.service.ts`, over the stored-payload schema in `apps/api/src/modules/personalization/planner-payload.schema.ts`.
- Story 5.5 Task 6 step 2 owner: own the routes, the guard stack, the platform header check and response parsing in `apps/api/src/modules/personalization/planner.controller.ts`, registered in `apps/api/src/modules/personalization/personalization.module.ts`.
- Story 5.5 Task 7 step 1 owner: own transport, failure classification and the temperature and date formatters in `apps/web/src/lib/planner.ts`.
- Story 5.5 Task 7 step 2 owner: own the entitlement state machine, the week render, per-date reshuffle state and both variants' focus behaviour in `apps/web/src/app/components/planner-rail.tsx`.
- Story 5.5 Task 7 step 3 owner: own the Plan week control, the closed default and the 1440px variant decision in `apps/web/src/app/components/lookbook-prism-layout.tsx`.
- Story 5.5 Task 8 step 1 owner: own transport and failure classification in `apps/mobile/src/lib/planner.ts`.
- Story 5.5 Task 8 step 2 owner: own the screen states, the themed day cards and the per-date reshuffle in `apps/mobile/src/features/premium/planner-screen.tsx`, reached from the thin route `apps/mobile/app/planner.tsx` and the `PlannerLinkRow` in `apps/mobile/app/(tabs)/settings.tsx`.
- Story 5.5 Task 7/8 step 4 owner: own the `commerce.premium.planner.*` subtree across the ten catalogs in `apps/web/src/i18n/locales/` and `apps/mobile/assets/locales/`, plus `commerce.premium.plannerLocked.*` on mobile.

Tests that cover this step:

Engine and date unit tests:

- [`apps/api/src/modules/personalization/ritual-generation.engine.spec.ts`](../../apps/api/src/modules/personalization/ritual-generation.engine.spec.ts): pins the 08:00 anchor cutoff on both sides and across a spring-forward boundary.
  It covers seven unique consecutive dates across a month end, a year end, a leap day and a non-leap February, and `toDatabaseDate`'s UTC-midnight storage and its rejection of an invalid calendar date.
  It also covers the hourly segment matcher, the daily projection with and without feels-like bounds, the summary-evidence suffix, the unavailable baseline with zero weather badges, and all three exclusion behaviours, including the fallback to an excluded garment when it is a category's only option.
- [`apps/api/src/modules/personalization/ritual.service.spec.ts`](../../apps/api/src/modules/personalization/ritual.service.spec.ts): the extraction's regression proof.
  Its 50 tests pass unchanged, which is what makes the engine lift a refactor.

Contract and analytics unit tests:

- [`packages/api-client/testing/planner-contract.spec.ts`](../../packages/api-client/testing/planner-contract.spec.ts): proves the days collection rejects a wrong count, a duplicate date at the right count, non-consecutive dates, an out-of-order week whose dates are still unique and consecutive, an invalid calendar date and a malformed shape.
  It proves a ready day rejects a duplicate scenario at the right count and a non-null `shopThisLook`, and that the platform header, the query params and the reshuffle body all reject unknown keys.
- [`packages/api-client/testing/planner-analytics.spec.ts`](../../packages/api-client/testing/planner-analytics.spec.ts): builds both events on the HMAC subject, rejects `daysReady` outside 0 through 7 and `dayOffset` outside 0 through 6, and proves the `.strict()` allowlists reject anything beyond the named properties (`5.5-CON-020` through `5.5-CON-027`).

Real-PostgreSQL database tests:

- [`packages/db/test/planner-schema.spec.ts`](../../packages/db/test/planner-schema.spec.ts): pins the `PlannerOutfitSource` members, the `(user_id, location_id, plan_date)` unique key, the same date across two locations, and the composite foreign key rejecting another user's location.
  It also pins `authenticated` holding exactly the four owner verbs with `anon` holding none, the four policy names, both cascades and a malformed payload round trip (`5.5-DB-020` through `5.5-DB-029`).
- [`packages/db/test/rls/planner.spec.ts`](../../packages/db/test/rls/planner.spec.ts): the full owner-only actor matrix (`5.5-DB-001` through `5.5-DB-008`), matching `palette-advisor.spec.ts` case for case.
  It covers owner read/update, owner insert/delete through the `authenticated` role, both guardian levels denied, unrelated user and `anon` denied, admin access, a spoofed `user_metadata` role denied, an unverified email denied and cross-user insert forgery denied.
- [`packages/testing/test/planner.factory.spec.ts`](../../packages/testing/test/planner.factory.spec.ts): proves the fixture persists and cleans up (`5.5-FACTORY-01` through `5.5-FACTORY-04`).

API unit tests:

- [`apps/api/src/modules/personalization/planner.service.spec.ts`](../../apps/api/src/modules/personalization/planner.service.spec.ts): proves the flag gate runs before any location or wardrobe read, seven consecutive ready days on first generation, hourly-exact and unavailable confidence selection, and ownership rejection of a foreign `locationId`.
  It proves a stored day is reused on an unchanged fingerprint, regeneration on each of the five dependency inputs independently, the cold-read race returning the persisted winner, a single-day failure isolated from the other six, pruning before the anchor date, and both analytics emissions.
  Reshuffle is covered for the flag gate, a malformed and an out-of-window `planDate`, a missing row and a version conflict both answering 409 without mutation, the atomic version and `reshuffle_count` bump, garment preference, and `unchanged: true`.
- [`apps/api/src/modules/personalization/planner.controller.spec.ts`](../../apps/api/src/modules/personalization/planner.controller.spec.ts): proves the guard stack over HTTP, the `x-couture-platform` rejection, query and body validation, and the `200` reshuffle status the contract declares.

Real-PostgreSQL API integration tests:

- [`apps/api/integration/planner.integration.spec.ts`](../../apps/api/integration/planner.integration.spec.ts): seven tests against a real Nest app and real PostgreSQL (`5.5-INT-01` through `5.5-INT-07`) proving what a mocked Prisma cannot.
  They cover regeneration when a comfort preference changes the fingerprint, pruning of rows before the anchor date, exactly one winner in a concurrent cold-read race with both callers returning it, and cascade deletion with the saved location.
  They also cover regeneration of a row that fails the persisted-payload schema, regeneration of a fingerprint-stable row referencing a garment that has become ineligible, and a stale reshuffle version answering a real 409 that leaves the row untouched.

Web unit and component tests:

- [`apps/web/src/app/components/planner-rail.test.tsx`](../../apps/web/src/app/components/planner-rail.test.tsx): drives every state through MSW.
  That includes the closed rail issuing no request, the signed-out locked panel, the checking skeleton, a full ready week with Fahrenheit conversion at `en-US`, the unavailable-confidence note, an isolated day error with retry, and the 403 and 503 split.
  It covers reshuffle success, `unchanged` and 409 paths, double-activation prevention, and abort on close for both the week fetch and an in-flight reshuffle.
  It covers the overlay focus trap with Escape and Tab wrapping, focus restore to the opener, refresh on window focus while open, and a 2x2 axe matrix over both variants crossed with both entitlement states.
- [`apps/web/src/app/components/lookbook-prism-layout.test.tsx`](../../apps/web/src/app/components/lookbook-prism-layout.test.tsx): four planner blocks rewritten around the open-then-assert flow against a real MSW-backed planner fixture.
- [`apps/web/src/lib/planner.test.ts`](../../apps/web/src/lib/planner.test.ts): thirteen tests over the transport layer alone, through real MSW round trips against the generated client.
  It pins the no-session short circuit that fires no request, and every status classification (401, the entitlement 403 against an unrecognised one, 503 and the reshuffle 409 keyed on the server's own message constants).
  It also pins the developer-facing fallback on a malformed error body, the `en-US`-sees-Fahrenheit rule, and `formatPlannerDateLabel` holding a calendar date steady regardless of the reader's timezone.
- [`apps/web/src/i18n/planner-locales.spec.ts`](../../apps/web/src/i18n/planner-locales.spec.ts): pins the exact 47 web planner keys, an identical key tree and identical interpolation placeholders across all ten locales, no English left in a non-English catalog and no empty string (`5.5-I18N-WEB-01` through `5.5-I18N-WEB-06`).

Mobile unit and screen tests:

- [`apps/mobile/src/screens/planner-screen.test.tsx`](../../apps/mobile/src/screens/planner-screen.test.tsx): thirteen tests through real MSW round trips (`5.5-MOB-01` through `5.5-MOB-13`).
  They cover loading, signed-out and non-entitled locked states, the 503 disabled notice, an unclassified failure with retry, the full seven-date week, and degraded weather rendering no temperature claim.
  They also cover an isolated error card beside six ready dates, whole-week retry, reshuffle success, `unchanged`, a 409 conflict and double-tap protection.
- [`apps/mobile/src/lib/planner.test.ts`](../../apps/mobile/src/lib/planner.test.ts): fourteen tests over the mobile transport layer, the counterpart of the web file above.
  They cover `readServerMessage`'s catch on a non-JSON error body, the `ResponseError`-versus-transport split, the final non-`Error` fallback, an aborted request with a non-`Error` reason, and `formatPlannerDayLabel`'s defensive fallback on a malformed date.
  They took `src/lib/planner.ts` from 93.33% statements and 67.56% branches to 100% and 94.59%.
- [`apps/mobile/src/i18n/planner-locales.spec.ts`](../../apps/mobile/src/i18n/planner-locales.spec.ts): pins 35 `planner` keys and 2 `plannerLocked` keys, both trees identical across all ten locales, and the three weather confidence labels distinct in every locale (`5.5-I18N-MOB-01` through `5.5-I18N-MOB-07`).

Contract (Pact) tests:

- [`pact/http/consumer/interactions/planner.ts`](../../pact/http/consumer/interactions/planner.ts) with its provider doubles in [`pact/http/provider/doubles/planner.ts`](../../pact/http/provider/doubles/planner.ts): fourteen interactions across web and mobile covering the fully ready week, the partial week with one isolated error day, the 403 and 503 access-error pair, and reshuffle success, `unchanged` and the 409 conflict.

End-to-end tests:

- [`playwright/tests/planner.spec.ts`](../../playwright/tests/planner.spec.ts): five tests against a live web, API and database stack using the seeded `premium-active-user` (`5.5-E2E-01` through `5.5-E2E-05`).
  They cover the overlay at 1280px and the inline rail at 1440px, each with a real axe scan and an assertion that the rendered week matches the captured `GET` response.
  They also cover a one-day reshuffle with its live-region announcement surviving a full reload, isolated per-day error recovery through retry, and focus restore to the opener through both Escape and the close control.
- [`maestro/premium-planner.yaml`](../../maestro/premium-planner.yaml): proves the settings link row, the navigation and the locked panel for the harness's fresh signed-up user.
  Its header states the scope: the harness user has no Premium entitlement, so the entitled, ready-week and reshuffle branches are out of a Maestro run's reach.

Evidence boundaries:

- Manual VoiceOver and TalkBack passes were not performed.
  The environment had no physical device and no real screen reader, and the story records that.
  Keyboard evidence exists at two tiers: `planner.spec.ts` drives real `Escape` and `Tab` keypresses through Chromium against the rendered page, and both surfaces' component tests assert roles, accessible names and live-region politeness.
  A physical-device screen-reader pass is open, recorded in `deferred-work.md`'s story 5.5 section on 2026-09-05.
- Maestro covers the locked state and navigation only.
  The entitled week and reshuffle are proven at the component tier through MSW and end to end through Playwright.
- The deployed WeatherAPI forecast depth is an operator verification.
  Configured fixtures cover provider depth; nothing in the suite can prove what a production WeatherAPI subscription returns, so `WEATHERAPI_FORECAST_DAYS` stays at its default of 3 until the plan is confirmed.
- Pruning is tested at the window boundary and through cascades.
  No test advances wall-clock time across a real retention period.
- There is no k6 scenario.
  Planner reads are Premium-only and user-scoped, and they sit outside the existing hot-path performance budget.
- Every planner scenario returns `shopThisLook: null` by contract, so this surface has no affiliate behaviour to cover at any tier.
- Test id coverage is uneven.
  The database, contract, analytics, integration, mobile screen, localization, factory and end-to-end tiers carry `5.5-` ids.
  The three API unit specs, all three web specs and `apps/mobile/src/lib/planner.test.ts` carry none, so those tiers cannot be traced by id from the story's test plan.
- None of this story's test files carry the `Learning path Step` cross-link comment this document's own contract asks for.
  All eighteen are named in `deferred-work.md`'s story 5.5 section.

Architecture diagram:

```mermaid
flowchart TD
  REQ["GET /api/v1/commerce/premium/planner\nx-couture-platform required"] --> AUTH
  AUTH{"RequestAuthGuard\nthen PremiumEntitlementGuard"} -- "missing or invalid" --> E401["401"]
  AUTH -- "no entitlement" --> E403["403 PREMIUM_REQUIRED_MESSAGE"]
  AUTH -- "entitled" --> FLAG{"premium_planner_enabled\nregistry default false, true in the seed"}
  FLAG -- "off" --> E503["503 PREMIUM_PLANNER_DISABLED_MESSAGE"]
  FLAG -- "on" --> ANCHOR["resolveRitualAnchorDate\n08:00 local cutoff"]

  ANCHOR --> WINDOW["resolvePlannerDateWindow\nseven dates, UTC date-part arithmetic"]
  WINDOW --> PRUNE["deleteMany plan_date < anchor\nacting user only"]
  PRUNE --> LOAD["load in parallel:\ncomfort preferences, latest weather,\neligible garments + capsules"]
  LOAD --> FP["computeDependencyFingerprint\nSHA-256 over location, weather revision,\ncomfort, locale, garment/capsule updated_at,\ncapsule_revision"]

  FP --> DAY{"per date, in parallel:\nstored row fingerprint match\nAND every referenced id still eligible"}
  DAY -- "hit" --> READY
  DAY -- "miss" --> WX{"weather for this date"}
  WX -- "08:00 + 13:00 + 19:00 present" --> HOURLY["confidence hourly"]
  WX -- "daily summary only" --> DAILY["confidence daily\nmin / max / midpoint\nbadges suffixed with the summary note"]
  WX -- "neither" --> UNAVAIL["confidence unavailable\nwardrobe + comfort baseline\nno temperature, condition or freshness"]
  HOURLY --> GEN
  DAILY --> GEN
  UNAVAIL --> GEN["generateRitualScenarios\nmorning / midday / evening"]
  GEN --> PERSIST["existing row: update by id\nmissing row: create, P2002 returns the winner"]
  PERSIST --> READY["ready day\nplanDate, version, weather, three outfits"]
  DAY -- "any throw" --> ERRDAY["error day\ngeneration_failed, retryable"]

  READY --> ENRICH["batched garment lookup\ncategory + 900s signed read URL"]
  ERRDAY --> RESP
  ENRICH --> RESP["plannerResponseSchema.parse\nexactly 7 unique consecutive dates\ndaysReady counts the ready ones"]
  RESP --> TEL["premium_planner_viewed\nplatform, daysReady"]

  RESHUF["POST /planner/:planDate/reshuffle\nbody expectedVersion"] --> EXCL["exclude the current garment and capsule ids\nas a soft preference"]
  EXCL --> UPD{"updateMany WHERE id AND version = expectedVersion"}
  UPD -- "count 0" --> E409["409 PLANNER_DAY_CHANGED_MESSAGE\nrow untouched"]
  UPD -- "count 1" --> BUMP["version + 1, reshuffle_count + 1,\nsource reshuffled"]
  BUMP --> EQ["payloadsEquivalent\ncompares sorted garment sets + capsule ids\nagainst the pre-reshuffle payload"]
  EQ --> TEL2["premium_planner_day_reshuffled\nplatform, dayOffset, unchanged"]
```

## Step 38: Community feed by climate band

User/business impact:

Turns a private daily ritual into a social one.
A member opens the community surface on web (`community-lookbook-grid.tsx` inside the Lookbook Prism layout) or mobile (the `Community` tab, now a twelve-line route shim over `src/features/community/community-screen.tsx`).
They see published looks from people in the same climate band, filtered by a chip strip whose eight values are the feed's own `mode` parameter: `auto`, `all`, and the six `CLIMATE_BANDS`.
Posting has two steps: allocate an upload session and PUT the bytes, then publish with a caption, an alt text the author has confirmed, and an optional weekly challenge.
Every post is screened before anyone sees it.
Members can report a post, withdraw their own, and have everything erased.

Two properties define the shape.
The first is that authors are pseudonymous to each other, and the database enforces it.
All six community tables have RLS with zero policies and zero grants to `anon` and `authenticated`, so a direct PostgreSQL client sees nothing, and every read is the API's allowlisted projection under a minted alias.
The second is that the pipeline fails closed.
ADR-013's NSFW model is not a dependency of this repository, so `UnavailableNsfwImageScreener` refuses every image and each post ends at `flagged` for human review.
Both rollout controls, `community_read_enabled` and `community_write_enabled`, default to false, and production stays dark until eight signatures land.

Key takeaways:

1. **Key a public cursor on the column that decides visibility.**
   The feed's cursor is `published_at,id`.
   Moderation stamps `published_at` long after `created_at`.
   A cursor ordered on creation time would place a newly published post behind a position the reader has already consumed, and that reader would never see it.
   The ordering column has to be the one whose value changes when the row becomes visible.
2. **Put the filter inside the cursor.**
   `communityFeedCursorPayloadSchema` carries `publishedAt`, `id` and `mode`.
   `safeDecodeCommunityFeedCursor` takes an `expectedMode` and rejects a mismatch with the same stable message a malformed cursor produces.
   A client that changes filters restarts paging, and a cursor minted under one filter cannot page another.
3. **Make every filter value requestable through one parameter.**
   The original contract had an optional `climateBand` where absence meant `auto`, which left `all` unrequestable.
   The beta experiment assigns viewers 50/50 between `auto` and `all`, so an unrequestable `all` made the experiment unrunnable.
   `communityFeedModeSchema` is now one eight-value enum.
4. **A row with no sort key cannot share a page with rows that have one.**
   A draft has no `published_at`, so `items` carries published rows only.
   The caller's own non-published posts move to `authorStates`, an unpaginated array with a `moderationReason` so the author sees a recovery state.
5. **Put the guarantee in the type, then back it with a record.**
   `altTextConfirmed` is `z.literal(true)`, so the contract rejects an unconfirmed publish at the HTTP boundary.
   The database adds `LookbookPost_alt_text_confirmed_when_published`, a CHECK that a published row carries `alt_text_confirmed_at`, because a boundary check leaves no record.
   The stamp is written in the same `updateMany` statement as the text it confirms.
   No edit can slip between the two and leave the row claiming the author approved wording they never saw.
6. **PostgreSQL RLS is row-scoped, so a column-level hole needs a different answer.**
   A published-row SELECT policy would leak `user_id`, `image_object_path`, `location_key` and `moderation_engine_version` to any authenticated caller.
   The inherited owner UPDATE policy has no column restriction, so an author could move their own draft to `published` and write their own `moderation_engine_version`.
   No better predicate closes either one.
   The migration therefore enables RLS, drops every policy, and revokes all grants from `anon` and `authenticated` on all six tables.
7. **"service_role" in this schema's comments names a trust level.**
   Reads and writes travel on the API's own privileged connection, the schema owner Prisma connects as.
   `service_role` is denied on every Prisma-managed table here, so reading the comments as a login name misleads.
8. **Model an overlap constraint as the set of things a row occupies.**
   A challenge with a null `climate_band` is global and must conflict with any band-scoped challenge whose window overlaps it.
   An equality key over the band cannot express that, because `'*'` and `'cold_wet'` are different keys that never collide.
   `CommunityChallenge_no_overlap` maps each band to an `int4range` slot and a global row to `int4range(0, 6)`, then excludes on `&&` over both the slot range and `tsrange(starts_at, ends_at, '[)')`.
   Both operands are ranges, so no `btree_gist` is needed.
   The columns are Prisma `DateTime`, so `tstzrange` would need a cast that is not immutable, and the index would be rejected.
   `WHERE (is_active)` frees a closed challenge's slot.
9. **Retention and erasure pull in opposite directions, so denormalize the evidence.**
   `ModerationEvent.post_id` is `ON DELETE SET NULL`, with `subject_alias`, `content_snapshot` and `image_object_path` stored on the row.
   With a cascade, an author deleting their account destroyed the abuse reports third parties had filed against them.
   Reporter uniqueness moved to `CommunityPostReport`, which also owns the snapshot and the SLA clock, so `ModerationEvent` is append-only again.
10. **A rolling window needs a lock.**
    The cap is ten accepted submissions in `(now-24h, now]`.
    A `(user_id, window_start)` unique key caps a fixed bucket and would admit twenty submissions around a boundary.
    `publishWithinQuota` opens its transaction with `SELECT pg_advisory_xact_lock(hashtext('community_submission:' || userId))` as the FIRST statement, then counts.
    Counting before locking is the check-then-act race the cap exists to close.
    The lock is per author and released at commit, so it does not serialise the table.
11. **Count the event the cap is about.**
    The window counts `submitted_at`.
    The row is created at allocate time and a replayed allocate reuses it through the idempotency key, so counting `created_at` would charge a retry against the author's daily cap.
12. **An absent safety model must fail closed.**
    ADR-013 names a TensorFlow.js NSFW model; neither `nsfwjs` nor `@tensorflow/tfjs-node` is a dependency here, and adding one is the story's own ask-first item.
    `UnavailableNsfwImageScreener` returns `passed: false` with reason `screening_unavailable` and engine version `adr013-nsfw-unavailable`, so every post ends at `flagged`.
    `DefaultCommunityModerationEngine` takes the screener through its constructor, so the real model drops in with no other change.
13. **A test-only fixture has to be unmistakable in the data it leaves behind, and honest in both directions.**
    This story ships two.
    `FixtureNsfwImageScreener` clears images for the unit and end-to-end paths; `FixtureCommunityModerationEngine` is the whole engine the integration tier publishes through.
    Both refuse to construct outside `allowsTestOnlySecrets()`, the gate every other fixture here uses, and the screener also requires `COMMUNITY_NSFW_SCREENER=fixture`.
    Both sign their output: `FIXTURE_IMAGE_ENGINE_VERSION` and `FIXTURE_TEXT_ENGINE_VERSION` append `-fixture`, and the integration tier pins the pair as `adr013-text-v2.0-fixture;adr013-nsfw-v1.0-fixture`.
    The easy direction to get wrong is the other one.
    When no `textOutcome` is pinned, the fixture engine's text half keeps the REAL `adr013-text-v2.0`, because it then delegates to the genuine dictionary screening and that work really ran.
    A blanket suffix would claim no work happened where it did.
    The version string has to report what ran.

    `moderation_engine_version` is the two halves joined as `text;image` (`community-moderation.processor.ts:144`), so the whole posture reads off one column.
    Four values were reachable in the Story 6.1 snapshot, and the first one below describes that snapshot's production posture:
    - `adr013-text-v2.0;adr013-nsfw-unavailable`: real dictionary screening with no image model.
    - `adr013-text-v2.0-fixture;adr013-nsfw-v1.0-fixture`: the integration tier and local end-to-end stack, with both halves pinned.
    - `adr013-text-v2.0;adr013-nsfw-v1.0-fixture`: real dictionary screening with a pinned image outcome.
    - `adr013-text-v2.0;adr013-nsfw-v1.0`: both halves real, reachable after the ADR-013 model is wired.

    The production string records the fail-closed posture: the text half is real work, and the image half names its own absence.
    A reader who sees only the fixture string could conclude the whole pipeline is stubbed; production runs real text screening.

14. **Screen in every language you have a dictionary for.**
    Text screening runs all dictionaries regardless of the declared locale, because the locale comes from the client: declaring `de-DE` used to disable the Spanish and French filters.
    An unknown locale is recorded as `locale_unscreenable` and counts against the verdict.
15. **A pseudonym derived from the identity it hides can be reversed.**
    The alias took four characters of an unkeyed `sha256(userId)`: 65,536 buckets over an enumerable input.
    Anyone with a candidate list could confirm authorship by hashing, and roughly one author pair in three hundred shared a suffix, well inside a thousand-viewer beta.
    The alias is now eight random hex characters stored in `CommunityAlias`, with unique constraints on both `user_id` and `alias`, so it has no relationship to its owner to invert.
16. **Split the rollout control in two.**
    `community_read_enabled` and `community_write_enabled` both default false.
    The beta can open reading to a cohort while posting stays shut, and closing posting after an incident leaves the feed readable for everyone already in it.
17. **Distinguish "you may not see this" from "we cannot serve this".**
    A published row whose stored object cannot be signed is a storage inconsistency on our side.
    The feed omits it and logs at ERROR under the stable event name `community_media_unsignable`, and the single-post read answers 503 `COMMUNITY_MEDIA_UNAVAILABLE_MESSAGE`.
    A post the caller may not see still answers 404.
18. **A URL on a broadcast cannot be revoked.**
    `mediaUrls` was removed from the `lookbook:new` socket payload, because a pushed URL has no expiry and no revocation path, so a takedown cannot reach one a client already holds.
    The payload is `.strict()`, since a plain `z.object` strips unknown keys and would let a producer believe it had delivered a field that was discarded.

Hard-won lessons from the implementation and code review of this story:

1. **A transactional outbox with no consumer is a queue that never runs.**
   `publishPost` wrote `CommunityModerationOutbox` rows inside the publish transaction, which is the correct producer side, and nothing ever read them.
   `CommunityModerationQueue.enqueue` had no production caller and the worker was never registered.
   Every post ended at `pending_review`, and no image or caption was screened at all.
   `CommunityModerationOutbox` now has a dispatcher that claims unhandled rows, enqueues each under a deterministic job id, and records the outcome on the row, the way `CapsuleTelemetryOutbox` already did for capsule analytics.
2. **A seeded row whose object does not exist is worse than no row.**
   The seed wrote `image_object_path` values with no bytes behind them.
   The feed drops any post it cannot sign, so `GET /feed?mode=all` answered `200` with an empty list while the identical Prisma query returned all five rows.
   The database alone cannot show this, which is why it survived.
   `packages/db/prisma/seeds/community-storage.ts` now uploads first and throws when storage is unreachable.
3. **Two SQLSTATEs, two different Prisma error shapes.**
   Measured against Prisma 6.19, an exclusion violation (`23P01`) arrives as `PrismaClientKnownRequestError` with the state in `meta.code`.
   A CHECK violation (`23514`) arrives as `PrismaClientUnknownRequestError` with `code` and `meta` both undefined and the state only inside the message text.
   Reading `meta.code` alone made the `23514` branch unreachable while every overlap assertion passed, so a backwards challenge window returned 500 where the contract promises 400.
   `extractSqlState` now reads both routes.
4. **One logical identifier, truncated two different ways, reads as a rename forever.**
   `AlertDeliveryOutbox_deduplication_key_reservation_started_at_idx` is 67 characters.
   PostgreSQL truncated it at its 63-byte limit and dropped the `_idx`; Prisma truncates the same name keeping the suffix.
   Without an explicit `map:` the two disagree on every clean checkout, and `prisma migrate diff` reports a permanent rename.
   The database's name is the real one.
5. **Leave an index Prisma cannot express out of the schema.**
   The partial advisor-offer index has `WHERE advisor_slot IS NOT NULL`, which the Prisma DSL cannot express.
   Declared as a plain `@@index`, it produced permanent drift on a clean checkout.
   The next `migrate dev` would have emitted a `CREATE INDEX` under a name the database already holds (`42P07`), or a well-meaning fix would have dropped the predicate and regressed the query plan the index exists for.
   It stays undeclared, and a schema test guards the object itself.
6. **Those two defects have a shared upstream cause.**
   `prisma migrate dev` has been unusable in this repository since April.
   No `shadowDatabaseUrl` is configured, so the shadow database has no Supabase `auth` schema, and the April guardian-RLS migration's `LANGUAGE sql` functions fail validation at CREATE FUNCTION time.
   When the command works, Prisma authors migrations and applies its own truncation consistently on both sides.
   When it does not, migrations get hand-written, and both defects lived in hand-written SQL.
   The claim has a limit: RLS policies, triggers and storage buckets cannot be expressed in Prisma and would have been hand-written regardless.
   The fix, the evidence, and a fossil shadow database proving somebody already hit this wall in April are recorded in `deferred-work.md`.
7. **Constructing an API client inline drops whatever the factory was adding.**
   The first draft of the web grid built `new CommunityApi(new Configuration(...))` directly.
   `createWebApiClient` is the only place `credentials: 'include'` is set, so every community call lost cookie auth and fell back to a `sessionStorage` bearer token as its only credential.
8. **A swallowed upload failure publishes a post with no bytes.**
   The web wrapper had the byte PUT inside `try { ... } catch { /* simulated in tests */ }` and published regardless.
   That produced the database-and-storage inconsistency from lesson 2, from the client side.
   Upload failure now throws `upload_failed` and nothing is published.
9. **Keep one polite live region per surface.**
   The grid had competing `role="status"` regions on the filter nav, the grid, the loading skeleton and the modal.
   That made `getByRole('status')` ambiguous in tests and made a screen reader hear the same state twice.
   The skeleton is now `aria-hidden` and the grid carries `aria-busy`.
10. **`accessibilityState` is native-only.**
    react-native-web's forwarded-props table has no entry for its object form, so the selected filter chip was not announced as selected on the web target that `app.json` ships.
    The chip also carries `aria-pressed`.
    ARIA allows `aria-selected` only on option, tab, row, gridcell and treeitem, so axe rejects it on a button under `aria-allowed-attr`, and `aria-pressed` is what the web chip strip already used.
    The active chip also has a 2px border, so selection does not depend on colour alone.
11. **Storing rendered strings in state ties a request to a language.**
    The grid stores a message key plus params, so `loadFeed` needs no `t` in its dependency list and a language change cannot re-fire a request.
    Every banner still re-renders in the new language.
12. **An inferred value can violate a boundary the code never mentions.**
    A legacy weather row with no precipitation was counted as a dry day.
    That inflated the wet-ratio denominator and inferred wetness for legacy rows, which the story lists as an explicit Never.
    A day is now usable only when at least one precipitation signal is present and in range, and a band resolves only from three or more usable days.
13. **"Ordered locations" means walk them.**
    Band resolution read the first saved location and stopped.
    A member whose first location had no usable weather got an unresolved band while their other locations classified fine.
14. **A uniqueness constraint breaks an append-only log.**
    Report uniqueness had been imposed on `ModerationEvent` as `UNIQUE (post_id, flagged_by_id)`.
    That capped the moderation history at one row per actor per post, so the audit table stopped being append-only.
15. **Concurrency tests earn their keep by being mutated.**
    Removing the advisory lock from `publishWithinQuota` lets twelve parallel submissions through against a cap of ten; restoring it gives ten accepted and two rate limited.
    `community-submission-limits.integration.spec.ts` states the consequence in its header: a failure there is an API defect, and it must not be retried, serialised, or given a bigger timeout.
16. **Compute an experiment assignment BEFORE the thing it is supposed to vary.**
    `getFeed` resolved `resolveCommunityExperimentVariant(userId)` after the feed query had already run, and only the telemetry call and the response field read the result.
    Both arms received whatever mode the client asked for, so they were identical by construction while analytics reported an assignment that changed nothing.
    No amount of traffic or analytics quality recovers a lift measured across two arms that served the same feed.
    The repair has three moves, and the third is the one most likely to be missed.
    Resolve the assignment before the query.
    Derive the served mode from it, so `auto` becomes the viewer's band or the unfiltered feed according to the arm.
    Bind the cursor to the EFFECTIVE mode, so page two resolves to the same arm as page one whether the client re-sends `auto` or echoes back the mode it was served.
17. **A fixture that signs with the real engine's name corrupts the audit trail.**
    `FixtureCommunityModerationEngine` reported `ADR013_IMAGE_ENGINE_VERSION` verbatim.
    Every row the integration tier published persisted `moderation_engine_version: 'adr013-nsfw-v1.0'`, the real model's identifier, on content no model had screened.
    That column outlives everyone who remembers which engine was wired on the day, and an auditor reads it to answer "was this screened", so those rows looked real by the only evidence that survives.
    The same pass found the fixture was safe from production use only because nothing happened to construct it.
    It now throws outside `allowsTestOnlySecrets()`, which makes that guarantee structural.

Story/Task mapping:

- Story 6.1
- Planning alignment (phase labels, launch gate and scope language across `couturecast_brief.md`, `couturecast_roadmap.md`, `prd.md`, `epics.md` and `epic-6-context.md`)
- Classification and schema (`packages/utils/src/climate-band.ts`, the Story 6.1 migration, RLS, factories, cleanup and seeds)
- Contracts (`community.ts` HTTP contracts, socket tuple parity, analytics events with `dedupeKey`)
- API (`apps/api/src/modules/community/`: feed, upload recovery, alt-text suggestion, screening, moderation and report handoff, challenges, withdrawal, erasure, and the two rollout controls)
- Clients (`community-lookbook-grid.tsx` and `community-screen.tsx` with identical localized states and disabled future filters)
- Verification (Pact, PostgreSQL integration, Playwright, Maestro, axe and k6)

Story reference:

- `_bmad-output/implementation-artifacts/6-1-community-feed-by-climate-band.md`, especially its `Spec Change Log`, which records how each ambiguous requirement was resolved and why
- `_bmad-output/implementation-artifacts/epic-6-context.md` for the epic's constraints and the Community Beta gate
- `_bmad-output/implementation-artifacts/deferred-work.md`, sections "Deferred from: story 6.1 community feed by climate band (2026-09-05)" and "Developer tooling found during the Prisma drift cleanup (2026-09-05)"

Cross-links:

- Step 16 provides the weather snapshots and the 60-minute freshness union band resolution reads.
- Step 25 provides the Lookbook Prism split layout the web grid lives in.
- Step 26 provides the chip and bottom-nav conventions the filter strip follows.
- Step 28 provides the accessibility hardening suite and the axe conventions both surfaces answer to.
- Step 22 provides the ten-catalog localization infrastructure and the parity spec convention `community-locales.spec.ts` follows on both surfaces.
- Step 29 and Step 30 provide the allocate/PUT-bytes/commit upload lifecycle, the storage adapter and the image validation this story mirrors.
- Step 5 provides the BullMQ queue and worker registration the moderation pipeline adds to.
- Step 18 provides the telemetry and audit baseline the moderation events and analytics extend.
- Step 33 provides the affiliate offer machinery whose partial index appears in lesson 5, and whose query-plan suite the feed's own plan test follows.
- Step 36 provides the owner-only RLS migration shape this story deliberately departs from, and the premium-surface client architecture both clients copy.

Sequence to follow:

1. Read the story's `Spec Change Log` first.
   It records thirteen decisions, and most of what looks surprising in the code is answered by one of them.
2. Read [`packages/api-client/src/contracts/http/community.ts`](../../packages/api-client/src/contracts/http/community.ts) top to bottom.
   Its message constants name every failure the clients branch on.
   `communityFeedCursorPayloadSchema` and `safeDecodeCommunityFeedCursor` are the pagination contract, `communityFeedModeSchema` is the filter, and `publishCommunityPostInputSchema` carries the `z.literal(true)`.
3. Read [`packages/db/prisma/migrations/20260905120000_add_community_feed_and_challenges/migration.sql`](../../packages/db/prisma/migrations/20260905120000_add_community_feed_and_challenges/migration.sql) from its header comment, which argues the RLS posture, then the two CHECK constraints and `CommunityChallenge_no_overlap`.
4. Read [`apps/api/src/modules/community/community.service.ts`](../../apps/api/src/modules/community/community.service.ts) in this order: `getFeed`, `resolveViewerBand`, `buildFeedItems` for the unsignable-object branch, `buildAuthorStates`, then `publishPost`.
5. Read [`apps/api/src/modules/community/community.repository.ts`](../../apps/api/src/modules/community/community.repository.ts) for `publishWithinQuota`'s advisory lock and for `extractSqlState`.
6. Read [`apps/api/src/modules/community/community-moderation.engine.ts`](../../apps/api/src/modules/community/community-moderation.engine.ts) for the two screeners and the combined verdict.
   Then read [`community-moderation.outbox.ts`](../../apps/api/src/modules/community/community-moderation.outbox.ts) and [`community-moderation.processor.ts`](../../apps/api/src/modules/community/community-moderation.processor.ts) for how a published row reaches that state.
7. Read [`apps/api/src/modules/community/community-alias.ts`](../../apps/api/src/modules/community/community-alias.ts).
   It is short, and its docblock is the clearest statement of what pseudonymity means here.
8. Read [`apps/web/src/lib/community.ts`](../../apps/web/src/lib/community.ts) and [`apps/web/src/app/components/community-lookbook-grid.tsx`](../../apps/web/src/app/components/community-lookbook-grid.tsx), then [`apps/mobile/src/features/community/community-screen.tsx`](../../apps/mobile/src/features/community/community-screen.tsx) beside them.
   Both surfaces classify the same failures into the same reason enum and render from the same 135-key catalog subtree.

Task owner map:

- Story 6.1 contract owner: define the community HTTP contracts, message constants, cursor codec, feed mode enum and challenge schemas in `packages/api-client/src/contracts/http/community.ts`, registered through `packages/api-client/src/contracts/http/openapi.ts`.
- Story 6.1 socket and analytics owner: own `CLIMATE_BANDS` tuple parity and the `.strict()` `lookbook:new` payload in `packages/api-client/src/types/socket-events.ts`, and the community events with their `dedupeKey` in `packages/api-client/src/types/analytics-events.ts`.
- Story 6.1 classification owner: own the band classifier, its usable-day rule and the `CLIMATE_BANDS` tuple in `packages/utils/src/climate-band.ts`.
- Story 6.1 schema owner: own the community models, the two CHECK constraints, the exclusion constraint, the cascade posture and the RLS block in `packages/db/prisma/schema.prisma` and `packages/db/prisma/migrations/20260905120000_add_community_feed_and_challenges/migration.sql`.
- Story 6.1 seed owner: own the community fixtures and the storage objects behind them in `packages/db/prisma/seeds/community-storage.ts`, with factories in `packages/testing/src/factories/community.factory.ts` and cleanup in `packages/testing/src/cleanup.ts`.
- Story 6.1 service owner: own feed assembly, band resolution, aliasing, upload allocation and replay, publication, reporting, withdrawal and challenges in `apps/api/src/modules/community/community.service.ts`.
- Story 6.1 repository owner: own the advisory-locked quota transaction, the report transaction and SQLSTATE mapping in `apps/api/src/modules/community/community.repository.ts`.
- Story 6.1 moderation owner: own the screeners and the combined verdict in `apps/api/src/modules/community/community-moderation.engine.ts`, the fixture screener in `fixture-nsfw-image-screener.ts`, the dispatcher in `community-moderation.outbox.ts`, and the job in `community-moderation.processor.ts`, wired through `community-worker-runtime.ts`.
- Story 6.1 maintenance owner: own the expiry and retention sweeps in `apps/api/src/modules/community/community-maintenance.service.ts` and their schedule in `community-maintenance.scheduler.ts`.
- Story 6.1 web owner: own transport and failure classification in `apps/web/src/lib/community.ts`, and the surface in `apps/web/src/app/components/community-lookbook-grid.tsx`.
- Story 6.1 mobile owner: own transport in `apps/mobile/src/lib/community.ts`, the screen in `apps/mobile/src/features/community/community-screen.tsx`, the route shim in `apps/mobile/app/(tabs)/community.tsx`, and the presentational components under `apps/mobile/components/community/`.
- Story 6.1 localization owner: own the `community.*` subtree across the ten catalogs in `apps/web/src/i18n/locales/` and `apps/mobile/assets/locales/`.

Tests that cover this step:

`npm run validate` exits 0 across typecheck, lint, test and build, in one run taken after the last code change landed: 392 files and 5,302 tests passing, 3 skipped.
By workspace: `apps/api` 185 files and 2,441 passing with 3 skipped (including the 41 community integration tests against real PostgreSQL), `apps/mobile` 78 files and 838, `apps/web` 47 files and 741, `@couture/api-client` 32 files and 781, `@couture/db` 30 files and 208, `@couture/testing` 12 files and 95, `@couture/utils` 7 files and 175, and `@couture/config` 1 file and 23.

Each outer tier was measured separately.
Pact records 116 web and 107 mobile interactions; the consumer determinism check passed over three runs, and provider verification exited 0 with zero failures.
Playwright is 157 passed, 0 failed, 1 skipped, with every `fixme` lifted; the one skip is a Story 4.3 spec that skips itself and predates this branch.
The Maestro community flow is green on a real Android device at 1m 24s solo.
The k6 smoke run is 73 checks with 0 failures and every threshold green.

Coverage rose on all three surfaces, with nothing lowered and nothing excluded.
`apps/api` is at 95.63 statements, 89.16 branches, 95.62 functions and 95.77 lines against a 94/88/95/94 gate; `apps/web` at 95.78/89.69/97.08/96.34 against 95/89/96/95; `apps/mobile` at 93.23/88.33/93.84/95.37 against 92/87/93/94.
The `apps/api` branch figure was RED at 87.73 against an 88 gate when this story picked the work up, so a story that added a module this size took the gate from failing to passing.

The k6 numbers are also the first real measurement of the `communityFeed` SLO, which the k6 config's own docblock recorded as owed.
There are two samples, both at one virtual user against a committed bound of 300ms.
Run 1 read p95 91.68ms all-region and 114.83ms band-filtered; run 2 read 86.39ms and 85.90ms.
Both runs stay in the record, because the band figure moving 29ms between two samples shows the first run's gap between the two index paths was noise.

309 unique `6.1-` test ids exist across the tiers: 83 `MOB`, 62 `WEB`, 59 `CON`, 36 `INT`, 35 `DB`, 10 `API`, 10 `FACTORY`, 8 `E2E`, 5 `PLAN` and 1 `CFG`.
Those id counts, the file inventories below, the 17 Pact interactions and the 135 locale keys were counted directly from the repository.

Contract and analytics unit tests:

- [`packages/api-client/testing/community-contract.spec.ts`](../../packages/api-client/testing/community-contract.spec.ts): the cursor codec including a mode mismatch, the feed mode enum, the collection and projection invariants, the `z.literal(true)` alt-text confirmation, and the challenge window rules.
- [`packages/api-client/testing/community-analytics.spec.ts`](../../packages/api-client/testing/community-analytics.spec.ts): set equality across the analytics registries, the strict property allowlists, and the `dedupeKey` every community event carries.
- [`packages/api-client/testing/community-socket-parity.spec.ts`](../../packages/api-client/testing/community-socket-parity.spec.ts): `CLIMATE_BANDS` parity between the tuple, the contracts and the socket payload, and the `.strict()` payload rejecting a resurrected `mediaUrls`.

Real-PostgreSQL database tests:

- [`packages/db/test/community-schema.spec.ts`](../../packages/db/test/community-schema.spec.ts): the enums, the two CHECK constraints, the exclusion constraint over band and window including the global-versus-band case, the cascade posture, and `ModerationEvent.post_id` surviving author erasure as null.
- [`packages/db/test/rls/community-posts.spec.ts`](../../packages/db/test/rls/community-posts.spec.ts): the API-only posture proven as denials.
  Every read and write from `anon` and `authenticated`, including an author against their own row, answers `42501`.
- [`packages/testing/test/community.factory.spec.ts`](../../packages/testing/test/community.factory.spec.ts): the community fixtures and their cleanup.

API unit tests:

- `apps/api/src/modules/community/` has a spec beside each unit: `community.service.spec.ts`, `community.controller.spec.ts`, `community.repository.spec.ts`, `community-moderation.engine.spec.ts`, `community-moderation.outbox.spec.ts`, `community-moderation.queue.spec.ts`, `community-moderation.worker.spec.ts`, `community-alias.spec.ts`, `community-alt-text.spec.ts`, `community-image-validation.spec.ts`, `community-maintenance.service.spec.ts`, `community-storage.adapter.spec.ts`, `community-storage.fake.spec.ts`, `community-worker-runtime.spec.ts` and `fixture-nsfw-image-screener.spec.ts`.

Real-PostgreSQL API integration tests:

- [`apps/api/integration/community-submission-limits.integration.spec.ts`](../../apps/api/integration/community-submission-limits.integration.spec.ts): the rolling cap and the report cap under real parallel transactions (`6.1-INT-010` onward).
  Its header states that a failure here is an API defect and must not be retried or serialised.
- [`apps/api/integration/community-moderation-pipeline.integration.spec.ts`](../../apps/api/integration/community-moderation-pipeline.integration.spec.ts): the outbox-to-worker path end to end, including the terminal states.
- [`apps/api/integration/community-lifecycle.integration.spec.ts`](../../apps/api/integration/community-lifecycle.integration.spec.ts): publication, withdrawal, consent suspension and erasure against real SQL.
- [`apps/api/integration/community-challenges.integration.spec.ts`](../../apps/api/integration/community-challenges.integration.spec.ts): the exclusion constraint's real 409s, including band against global.
- [`apps/api/integration/community-feed-query-plan.integration.spec.ts`](../../apps/api/integration/community-feed-query-plan.integration.spec.ts): the feed's keyset plan at volume (`6.1-PLAN-*`), EXPLAINing SQL captured from the Prisma client's own `query` event.
- [`apps/api/integration/community-experiment.integration.spec.ts`](../../apps/api/integration/community-experiment.integration.spec.ts): proves the experiment arms serve different rows, that a viewer's arm is stable across requests, and that an explicit band beats the assignment (`6.1-INT-070` through `6.1-INT-072`).

Web unit and component tests:

- [`apps/web/src/app/components/community-lookbook-grid.test.tsx`](../../apps/web/src/app/components/community-lookbook-grid.test.tsx): the surface driven through MSW, including the filter strip, cursor paging, the compose flow, reporting, withdrawal, the single live region and axe.
- [`apps/web/src/i18n/community-locales.spec.ts`](../../apps/web/src/i18n/community-locales.spec.ts): eight parity tests over the `community.*` tree in all ten catalogs.

Mobile unit and screen tests:

- [`apps/mobile/src/screens/community-screen.test.tsx`](../../apps/mobile/src/screens/community-screen.test.tsx): the screen through MSW, including filter changes dropping a held cursor.
- `apps/mobile/components/community/` has a test beside each presentational component: `community-card.test.tsx`, `community-filter-chips.test.tsx`, `community-challenge-banner.test.tsx`, `community-post-sheet.test.tsx` and `community-report-modal.test.tsx`.
- [`apps/mobile/src/i18n/community-locales.spec.ts`](../../apps/mobile/src/i18n/community-locales.spec.ts): nine parity tests, the ninth holding web and mobile value-identical in every locale.

Contract (Pact) tests:

- [`pact/http/consumer/interactions/community.ts`](../../pact/http/consumer/interactions/community.ts) with provider doubles in [`pact/http/provider/doubles/community.ts`](../../pact/http/provider/doubles/community.ts): 17 recorded interactions covering the feed, the cursor, the upload lifecycle, reporting, withdrawal and the challenge operations.

End-to-end and load tests:

- [`playwright/tests/community-feed.spec.ts`](../../playwright/tests/community-feed.spec.ts) and [`playwright/tests/api/community-feed.api.spec.ts`](../../playwright/tests/api/community-feed.api.spec.ts): the browser journey and the API-level checks (`6.1-E2E-*`, `6.1-API-*`), over the helpers in [`playwright/support/helpers/community-session.ts`](../../playwright/support/helpers/community-session.ts).
- [`maestro/community-feed.yaml`](../../maestro/community-feed.yaml): the mobile flow.
- [`k6/scenarios/community.scenarios.ts`](../../k6/scenarios/community.scenarios.ts): the feed's load profile.

Evidence boundaries:

- No real NSFW model runs anywhere in this repository.
  Every published post in every tier was cleared by a fixture that does not look at the bytes, so nothing here is evidence about image safety.
  The real screener is one of the eight signatures the Community Beta gate requires.
  Key takeaway 13 covers the two fixtures and how they sign their output.
- The suite results above were measured by the sessions that ran them, in one `npm run validate` and one pass of each outer tier, and the session that wrote this step did not re-run them.
  The id counts, file inventories, Pact interaction count and locale key count were counted from the repository here.
- The k6 figures are two samples at one virtual user against a five-row seed.
  They show the `communityFeed` SLO has been measured at all, and that the endpoint sits well inside its bound at seed scale.
  They say nothing about behaviour at volume, and two samples are not a latency distribution.
  Neither run resolves a cost difference between the two index paths; the band-filtered figure moved 29ms between them, so the extra index predicate does not show at this scale.
  That agrees with the `EXPLAIN` measurement in `deferred-work.md`, where both plan shapes run at roughly 0.03ms at fixture scale.
  A reader meeting the 114.83ms figure and the OR-form plan entry separately should not read the plan difference as already visible here.

  The structural half of the volume gap is closed.
  `community-feed-query-plan.integration.spec.ts` used to EXPLAIN hand-written SQL while the repository issued `prisma.lookbookPost.findMany`.
  `6.1-PLAN-02`, `-03` and `-04` now EXPLAIN SQL captured from the Prisma client's `query` event while `findPublishedFeedPosts` runs.
  `-04` pins the emitted shape so a rewrite of the cursor condition fails the test, and `-06` proves the captured-SQL assertions can fail.
  The plan the suite measures is the plan the application produces.

- The nine non-English catalogs are machine-translation drafts.
  Both parity specs hold structure, placeholders and cross-surface equality; none of them checks register, idiom or brand voice, and no native speaker has reviewed them.
  This is recorded in `deferred-work.md` as one of the eight gate signatures.
- Production rollout is off.
  `community_read_enabled` and `community_write_enabled` both default false, and they stay off until moderation staffing, SLA alerts, privacy, deletion, localization, accessibility, model and rollback evidence are signed.
- The beta experiment's assignment varies the feed, proven end to end, and nothing measures the result.
  `community-experiment.integration.spec.ts` runs the real assignment function, classifier, repository and database.
  `6.1-INT-070` proves two viewers issuing the same `mode=auto` request receive different rows: the auto arm gets in-band posts and none of the off-band ones, and the all arm gets the off-band posts the auto arm was denied.
  `6.1-INT-071` proves the arm is stable across requests, which keeps a page-two cursor in the same effective mode as page one.
  `6.1-INT-072` proves an explicit band beats the assignment for both arms.
  That claim used to rest on a service test asserting call arguments.
  The measurement is still open: no 1,000-viewer cohort exists and no analytics sink consumes these events.
  The 10% relative non-self card-open lift, the 15% unresolved-band guardrail and the 5% empty-feed guardrail have never been evaluated against real traffic.
  Hard-won lesson 16 covers how the assignment came to work.
- Nothing counts unique challenge participants.
  No production code does it; uniqueness is a dedupe-key convention that an analytics sink is trusted to honour, and that sink does not exist yet.
  The matrix's "count unique published participants" and AC 5's "one participation event persists" both rest on that convention.
  This was deliberate: exposing a count properly is a Story 6.2 contract change, and naming the missing consumer here is more useful than a method nobody calls.
- The 72-hour erasure deadline is proven as detection.
  `6.1-INT-033` proves an overdue request is identified as overdue, and no test advances wall-clock time across a real retention period, so completion inside 72 hours is unproven.
- Manual screen-reader verification was not performed.
  The axe scans, the semantic assertions and the real keyboard events in Playwright are what exists; VoiceOver and TalkBack passes on physical devices are open.
- Realtime announcement of a new post belongs to Story 6.2.
  No production code emits `lookbook:new` today; this story's only socket obligation is `CLIMATE_BANDS` tuple parity, which `community-socket-parity.spec.ts` proves.
- This step was written before its story merged, which this document's own instruction 2 reserves for implemented and reviewed work.
  It documents code that is shipped and green on `feat/epic6-story1`.
  Every suite result above is therefore a claim about that branch on 2026-09-05, and it should be re-read against the merge commit.

Architecture diagram:

```mermaid
flowchart TD
  subgraph Write
    ALLOC["POST /community/posts/allocate\nidempotency key, upload session"] --> BYTES["PUT bytes to private bucket\nno user id in the object path"]
    BYTES --> PUB["POST /community/posts/publish\naltTextConfirmed = literal true"]
    PUB --> LOCK["publishWithinQuota\npg_advisory_xact_lock FIRST\ncount submitted_at over (now-24h, now]"]
    LOCK -- "over 10" --> R429["429 rate limited"]
    LOCK -- "within cap" --> ROW["draft -> pending_review\nalt_text + alt_text_confirmed_at\nin ONE statement"]
    ROW --> OUTBOX["CommunityModerationOutbox row\nsame transaction"]
  end

  OUTBOX --> DISPATCH["outbox dispatcher\nclaims rows, deterministic job id"]
  DISPATCH --> WORKER["BullMQ moderation worker"]
  WORKER --> TEXT["text screening\nALL dictionaries, any declared locale"]
  WORKER --> IMAGE{"NsfwImageScreener"}
  IMAGE -- "Unavailable (production today)" --> FLAG
  IMAGE -- "Fixture (test envs only,\nCOMMUNITY_NSFW_SCREENER=fixture\nAND allowsTestOnlySecrets)" --> VERDICT
  TEXT --> VERDICT{"combined verdict\nboth engine results recorded"}
  VERDICT -- "passed" --> PUBLISHED["status published\npublished_at stamped\nCHECKs enforce both columns"]
  VERDICT -- "refused" --> FLAG["status flagged\nhuman review"]
  WORKER -- "retries exhausted" --> RFAIL["status review_failed"]

  subgraph Read
    FEED["GET /community/feed?mode=…"] --> RFLAG{"community_read_enabled"}
    RFLAG -- "off" --> D503["503 feed disabled"]
    RFLAG -- "on" --> BAND["resolve viewer band\nwalk ordered locations\nfresh or cached under 60 min\n3+ usable days"]
    BAND --> PAGE["keyset on published_at,id\ncursor carries mode AND resolved band\neither mismatch restarts paging"]
    PAGE --> SIGN["sign each object\nunsignable: omit + ERROR log\nsingle-post read answers 503"]
    SIGN --> ALIAS["CommunityAlias\n8 random hex, stored, never derived"]
    ALIAS --> ITEMS["items: published only"]
    PAGE --> STATES["authorStates: caller's own\nnon-published rows, unpaginated"]
  end

  PUBLISHED --> FEED
  RLS["all six tables: RLS on,\nzero policies, zero grants to\nanon and authenticated"] -.-> ITEMS
  RLS -.-> ROW
  ERASE["account erasure / withdrawal"] --> HIDE["hide first, then delete objects\nModerationEvent.post_id SET NULL\nsnapshot + alias retained 12 months"]
```

### A guard written for one workspace caught a different session's mistake in another

`prisma db seed` runs the seed graph under `tsx`.
There, a named import from a workspace `.ts` module resolves to a CJS namespace and the named export is not statically visible.
`5.4-DB-040` was written to catch that, for the seed modules that already had the problem.

Months later the user seed gained an `evaluateAgeGate` import from `@couture/utils`.
Different package, different session, and nobody involved had read that guard.
It failed immediately with `does not provide an export named 'evaluateAgeGate'`, before the next `db:seed` on somebody's machine could hit it.

That is the only direct evidence this story produced that a cross-cutting guard repays its cost.
It belongs next to the guards that never fired, because a test whose whole value is the bug you never saw is invisible in a retrospective.

The guard was cheap because it re-runs the real entry point, which is why it caught an import it was never written to know about.
A guard that reimplements the thing it checks can only catch what its author already thought of.

## Step 39: Production content-screening readiness

User/business impact:

After Step 38, nothing in the community pipeline could judge an image.
ADR-013's NSFW model was not a dependency of this repository, so `UnavailableNsfwImageScreener` refused every image and every post ended at `flagged`, waiting for a human who does not exist yet.
This step makes the judgement real.
A member uploads a look, confirms its alt text and publishes.
A supervised worker process decodes the bytes, runs a pinned local TensorFlow.js model over them, and screens the caption and alt text against reviewed term lists in seven languages.
It then publishes the post or holds it for review with a stable reason code.
Nothing leaves the machine: the model weights ship inside the pinned `nsfwjs` package, and the inference process installs a throwing `fetch` and a throwing `net.Socket.prototype.connect` before it imports anything.

Two rules shape the design.
Only `pass` can publish: missing model infrastructure, malformed model output, an unreadable locale and partly screened text all route to a human.
The persisted identity names the engine that actually ran.
A real screening records `adr013-text:policy-v1@<policy hash>;adr013-nsfw-...`, and a fixture run records an image half ending in `-fixture`, in the same column a moderator reads.

Production stays dark.
`community_read_enabled` and `community_write_enabled` remain false.
Story 6.2b owns the deployment, the corpus-backed measurement and the one signature this work authorises.

Key takeaways:

1. **Ship the model inside the dependency you already pin.**
   `nsfwjs@4.3.0` carries its MobileNetV2 Mid weights as base64 bundles, so there is no download, no cache directory, no remote model host and no `file://` handler.
   The bundles decode in memory and load through a `tf.io.IOHandler`.
   That removes a whole class of supply-chain and availability problems, and it makes AC 1's zero-network requirement structural.
2. **A `Promise.race` does not bound CPU-bound work.**
   The existing `withModerationTimeout` cannot stop a spinning inference, because the timeout and the work share a thread.
   Model execution runs in a supervised worker thread with its own 10-second termination ceiling, a 5-second failure cooldown and a bounded respawn.
   The 30-second outer ceiling still bounds the whole pipeline.
3. **Two conditions were not enough to keep an unsafe image out.**
   The first disposition function required a confident `Neutral` above 0.85 and no single unsafe class above 0.35.
   A vector of `Neutral` 0.86 with `Porn` 0.13 satisfied both and published.
   Pass now also needs an aggregate ceiling of 0.10 across the unsafe classes.
   The policy records the review that found it beside the number.
4. **Grade severity, then map the grade to a disposition in one place.**
   There are six categories, three severities, and a `severityDisposition` map where `low` and `medium` both resolve to review, so no matched term can publish.
   The grade is kept for queue priority and for Story 6.2b's per-severity measurement.
5. **Hash the policy into the engine identity.**
   The policy file is hashed, the manifest pins that hash, the loader recomputes it and refuses to start on a mismatch, and the identity string carries its first twelve characters.
   A threshold cannot move without the recorded identity moving too, which is what makes a persisted `moderation_engine_version` worth reading.
6. **Mirror a value only if you assert the mirror.**
   The manifest repeats five threshold values the policy owns, because AC 1 asks for them literally.
   The loader and the isolated inference process both assert that the mirror deep-equals the same five keys picked from the policy, so the copy cannot drift.
7. **Derive locale coverage from the canonical source and check set equality.**
   The seven screening languages come from `packages/api-client/src/contracts/http/supported-locales.json`.
   The check is set equality, so an extra list fails as loudly as a missing one.
8. **A regression gate above its own ceiling can never fire.**
   Three times the measured peak RSS is 1018 MiB against a 512 MiB absolute ceiling, so a gate there would always be pre-empted by the ceiling.
   Each gate is the smaller of three times measured and the absolute ceiling.
   The committed measured value is the slowest of the runs taken, so run-to-run variance sits inside the gate.
9. **Emit measurements; leave the verdict to the story that can measure it.**
   Every report labels the path that produced it.
   The payload says in words that neither the deterministic evaluation nor the fake-runtime lifecycle suite shows the real model reacting to genuinely unsafe input.
   That proof is Story 6.2b's corpus, and the statement keeps a green fixture run from reading as a release decision.

Hard-won lessons from the implementation and code review of this story:

1. **The story's own written API was wrong, and only running it found that.**
   The spec said the `nsfwjs/models/mobilenet_v2_mid` subpath exposes `modelJson()` and an array of base64 strings.
   It exports one named `MobileNetV2MidModel` whose `modelJson` is async and whose `weightBundles` are async functions, each resolving to an ES module namespace with the payload on `.default`.
   Calling it as written throws `TypeError: bundle.modelJson is not a function`.
   Three sessions were trusting that paragraph.
   The implementation now picks the export by shape, as the one with a callable `modelJson` and an array `weightBundles`, so a rename cannot break it either.
2. **`npm run verify:api` does not run the coverage ratchet.**
   `scripts/verify-workspace.mjs` runs lint, typecheck, `test` and build.
   Four slices reported `verify:api` exit 0 as coverage evidence, and none of it was.
   The ratchet lives in `test:coverage`, which is what `validate` and `pr-checks.yml` gate on.
   The thresholds are global, so a poorly covered file is masked by the rest of the tree, and four branches each above the ratchet can merge to below it.
3. **A fail-open hid in an inferred type, invisible to lint and to Vitest.**
   `severityDisposition` was built with `z.record` over the severity enum, which Zod infers as `Partial<Record<...>>` because it cannot promise a key per member.
   A consumer indexed straight into it.
   A policy missing a grade would have looked up `undefined`, ranked it `NaN`, never raised the disposition, and left a matched term publishable.
   Only `tsc` saw it.
   The field is now declared key by key, so the type is total at the source.
4. **Obfuscation coverage that only asserts "not pass" measures nothing.**
   The text screener's family tests were green while the longest German high-severity term only matched a milder seven-character term nested inside it.
   They now assert severity and disposition parity with the plain form.
   Multi-word phrases had no obfuscation coverage at all, so disguised phrase terms published.
   A fixed twelve-token join window meant a term longer than twelve characters was never rebuilt from its spaced or punctuated form, and it reached a clean pass with an empty reason list.
   That is the fail-open Step 38's empty-reason rule exists to remove, arriving by a different door.
   Running 358 shipped terms against 14 obfuscation combinations took the bypass count from 402 to 5.
5. **A term that collapses under the length floor needs an explicit guard.**
   Folding `gook` yields `gok`, the umlaut-less Turkish word for sky.
   The general rule: a term whose collapsed spelling falls under the floor is indexable only when that spelling is cleared on an allow list, and startup fails otherwise.
   A silent coverage loss becomes a loud one.
6. **`6.1-INT-060` was filed as a concurrency flake; the cause was cross-spec interference.**
   The test backdated `updated_at` to 2024, which made the row instantly claimable by `sweepStalePendingReview`.
   That sweep has no namespace filter because production has nothing to filter by, and `community-lifecycle.integration.spec.ts` drives it against the same shared database.
   The sweep wrote `review_failed`, then `process` found the row already out of `pending_review` and returned.
   Run alone, nothing runs the sweep.
   A tripwire now fails by name if the backdated value returns.
7. **A privacy assertion can be vacuous and still pass.**
   One check scanned the second member's feed for leaked safety data after earlier assertions had already proved the post was not in that feed, so it would have passed against an API that leaked everything.
   It now asserts on the author's own state and on the key set.
   Substring matching was dropped because `Porn` and `Sexy` are valid base64url four-grams, and a signed-URL signature can contain either by chance.
8. **Truthfulness bugs cluster where two identities are folded into one.**
   Folding the caption and alt-text results re-derived the text engine version from per-field provenance, and a pinned fixture reports none.
   So a fixture run briefly persisted an identity claiming the real engine had screened the post.
   Separately, the evidence emitter could never record a passing verification: it tested for status `passed`, and the verify script emits `verified`.
   Both were found by executing every branch.
9. **Two unguarded teardown paths could exit the worker process.**
   The startup-timeout callback terminated the worker a second time on top of `rejectInitialization`'s own terminate, unguarded.
   A rejecting `terminate()` became an unhandled rejection and a process exit, on exactly the path a wedged model startup takes.
   And `cleanup()` removed the `error` listener while the thread could still be alive, so a late error reached EventEmitter with no listener and rethrew as an uncaught exception.
   Neither is reachable through a fake worker; the second needs a real thread to fire.
10. **A worker thread carries its own globals.**
    `src/test-setup.ts` patches `fetch` in the supervisor, which does nothing for the one step that could plausibly fetch.
    The guard now installs inside the worker entrypoint before any import.
    It guards `net.Socket.prototype.connect` as well as `fetch`, because raw `net`, `tls`, `http` and `https` all reach the socket and none of them touch `fetch`.
11. **A non-`Error` rejection erases the cause.**
    A worker `error` event was forwarded without normalisation, so a missing TensorFlow.js install surfaced as `{ stacks: [] }` and seven smoke failures with no message.
    Every path that receives a worker event now normalises it, and the bare `{ stacks: [] }` is a named regression case.
12. **On this tree, `npm audit fix` reaches its "fixes" by walking platforms backwards.**
    It proposed `prisma@6.12.0` against an installed 6.19.0, `@nestjs/schedule@2.2.3` against 6.0.1, and `expo@40.0.1` against 54.
    All three were rejected.
    `fixAvailable: true` does not mean the command would take it.
13. **`onnx/model.onnx` is 605 MB and its download carried a 60-second total deadline.**
    That needed roughly 80 Mbps sustained and otherwise aborted a healthy transfer.
    So `test:tagging-model:smoke` could not run at all: its pre-hook failed three attempts and left `onnx/` empty.
    The budget is now a stall timeout rearmed on every chunk, and the body streams to disk; before, `arrayBuffer()` held it whole in memory.
14. **Chaining the `apps/api` gates in one shell invocation breaks them.**
    Each has a `pre*` hook running `prepare:shared-deps`, which deletes and rebuilds four packages' `dist`.
    Back-to-back runs read a directory mid-rebuild and produce spurious module-resolution failures that look exactly like a broken merge.
    Run one `prepare:shared-deps`, then the gates one at a time.
15. **Rebase stops being the right tool once a peer has merged your history.**
    A plain rebase flattens merges, and it silently replayed one slice's commits into another slice's branch as commits authored there.
    Five parallel branches that consume each other need merges.

Story/Task mapping:

- Task 0, the versioned hashed policy file, and Task 1, pinning the model, text library, policy and artifact supply chain: `policy-v1.json`, `community-nsfw-mobilenet-v2-mid-nsfwjs-4.3.0.json`, `community-screening-policy.ts`, `verify-community-screening-model.mjs`, `verify-community-screening-supply-chain.mjs`, `.env.example`.
- Task 2, supervised production image inference: `tensorflow-nsfw-image-screener.ts` and `community-nsfw-inference.worker.ts`.
- Task 3, reusable multilingual text screening: `community-text-screener.ts` and the fourteen files under `policies/community-screening/terms-v1/`.
- Task 4, wiring the combined policy into the durable pipeline, and Task 5, hardening worker startup, deployment and shutdown: `community-moderation.engine.ts`, `community-moderation.processor.ts`, `community-moderation.worker.ts`, `community-worker-runtime.ts`, `community-moderation.telemetry.ts`, `workers/bootstrap.ts`, `workers/community.bootstrap.ts`, `deployment-guide.md`.
- Task 6, versioned fixtures and local measurement, and Task 9, machine-readable measurements: `test/fixtures/community-moderation/v1/`, `community-moderation-fixtures.mjs`, `community-screening-measurements.mjs`, `community-content-screening-measurements.json`.
- Task 7, unit, integration and lifecycle tests, and Task 8, end-to-end publication evidence: every spec in the test map below, `playwright/config/local-restricted.config.ts`, `playwright/tests/community-publication.spec.ts`, `scripts/start-api-e2e-with-workers.mjs`.
- Task 10, quality gates: recorded under `Evidence boundaries`.

Story reference:

- `_bmad-output/implementation-artifacts/6-2-production-content-screening-readiness.md`.
  Its Decision 2 and Decision 7 were both corrected during implementation to match executed behaviour.
- `_bmad-output/implementation-artifacts/6-2b-community-screening-release-gate.md` for the deployment, the corpus and the signature this story leaves to 6.2b.

Cross-links:

- Step 38 for the upload, outbox, BullMQ, post-transition, audit and rollout foundation this step screens against, and for the RLS posture that hides community tables from direct database clients.
- Step 30 for the FashionCLIP garment-tagging pipeline, whose isolated inference worker, manifest-and-hash supply chain and eager-readiness bootstrap this step reuses.

Sequence to follow:

1. `apps/api/policies/community-screening/policy-v1.json`: every threshold with its reasoning beside it, and two `openQuestions` blocks recording what was weighed and deliberately left unset.
2. `apps/api/model-manifests/community-nsfw-mobilenet-v2-mid-nsfwjs-4.3.0.json`: the pinned artifacts and their hashes, the five-key threshold mirror, the policy hash, and the measured performance with its gate.
3. `apps/api/src/modules/community/community-screening-policy.ts`: the loader that hashes the policy, cross-checks the manifest against it and derives the engine identity.
4. `apps/api/src/modules/community/community-nsfw-inference.worker.ts`: the isolated entrypoint, with manifest verification, the in-memory `IOHandler`, `setWasmPaths`, warmup, positional class mapping and the network guards.
5. `apps/api/src/modules/community/tensorflow-nsfw-image-screener.ts`: the supervisor, with the readiness handshake, the three-way disposition, timeout termination, cooldown, respawn and close.
6. `apps/api/src/modules/community/community-text-screener.ts`: the reusable field-aware text boundary and its canonical representations.
7. `apps/api/src/modules/community/community-moderation.engine.ts` and `community-moderation.processor.ts`: how the two verdicts combine and what gets persisted.
8. `apps/api/src/modules/community/community-worker-runtime.ts` and `apps/api/src/workers/bootstrap.ts`: the selector, eager readiness and the close hooks.
9. `scripts/verify-community-screening-model.mjs` and `scripts/verify-community-screening-supply-chain.mjs`: what a green verification proves, and what a `skipped` one does not.

Task owner map:

- Policy and supply-chain owner: `community-screening-policy.ts` for loading, hashing and identity derivation; the two `verify:*` scripts for the command-line gates; `apps/api/policies/community-screening/policy-v1.json` as the single source of every threshold.
- Image inference owner: `tensorflow-nsfw-image-screener.ts` for the supervisor, the disposition function `evaluateNsfwDisposition` and the `NsfwReadiness` payload; `community-nsfw-inference.worker.ts` for everything that runs inside the isolated process.
- Text policy owner: `community-text-screener.ts` for `screen({ text, field, locale })`, the seven-language dictionaries, the allow lists and the canonical representations; `terms-v1/` for the vocabulary and its provenance records.
- Durable pipeline owner: `community-moderation.engine.ts` for the combined verdict, `community-moderation.processor.ts` for the guarded terminal transitions and the outbox stamp, `community-moderation.worker.ts` for attempts and concurrency, `community-moderation.telemetry.ts` for the privacy-safe counters and histograms.
- Worker lifecycle owner: `community-worker-runtime.ts` for the selector and the composed pipeline, `workers/bootstrap.ts` and `workers/community.bootstrap.ts` for eager readiness and graceful shutdown.
- Evidence owner: `scripts/community-moderation-fixtures.mjs` for the corpus and its integrity, `scripts/community-screening-measurements.mjs` for the payload, `playwright/config/local-restricted.config.ts` for the isolated restricted run.

Tests that cover this step:

Coverage on the integrated tree is 95.03% statements, 89.07% branches, 95.52% functions and 95.22% lines across 194 files, against the 94/88/95/94 ratchet.
Nothing was lowered and no file was excluded to reach it.

API unit tests:

- `apps/api/src/modules/community/community-nsfw-inference.lifecycle.spec.ts` (80 cases): manifest verification including the post-`realpath` symlink guard, the weight-bundle mirror, model-definition selection, manifest discovery, image decode, the network guards, startup failure, malformed output, crash, timeout termination, cooldown, respawn, shutdown, compiled worker-path resolution, and the two teardown paths that could exit the process.
- `apps/api/src/modules/community/community-text-screener.spec.ts` (62 cases): every obfuscation family in every language it applies to, whole-token matching that leaves ordinary fashion copy intact, allow-list precedence, mixed and unsupported scripts, per-field input ceilings, provenance failure per field, the locale map compared with the canonical JSON in both directions, and the terms-and-allow intersection pinned to exactly one accepted entry.
- `apps/api/src/modules/community/community-moderation.worker.spec.ts` (38 cases): three attempts, eventual success, exhaustion, the per-attempt `JobFailure` row, the final post transition, truthful identities, and the concurrency value pinned so it cannot drift back to five.
- `apps/api/src/modules/community/tensorflow-nsfw-image-screener.spec.ts` (37 cases): the deterministic disposition evaluation with every threshold crossed from both sides, malformed output routing to review, the reason-code wiring assertion, and the engine-identity composition.
- `apps/api/src/modules/community/community-moderation.engine.spec.ts` (30 cases): the combined verdict, the empty-reason fail-closed rule, and the explicit-verdict check that a refusal without a reason still refuses.
- `apps/api/src/modules/community/community-screening-policy.spec.ts` (29 cases): the policy hash, the five-key mirror, class-name value and order, list provenance, language set equality, and every disposition that must not resolve to `pass`.
- `apps/api/src/modules/community/fixture-nsfw-image-screener.spec.ts` (16 cases): the double gate and the visible `-fixture` marker.
- `apps/api/src/modules/community/community-moderation.telemetry.spec.ts` (11 cases): the privacy-safe counters and histograms, and that no user id, signed URL or raw matched term reaches them.
- `apps/api/src/modules/community/community-worker-runtime.spec.ts` (7 cases): the selector's three values, `ensureReady` before worker creation, and close ordering, screener then queue.
- `apps/api/src/workers/bootstrap.spec.ts` (4 cases) and `apps/api/src/workers/community.bootstrap.spec.ts` (4 cases): the `SIGTERM` close-hook registration, whose absence was the live defect this story fixed.
  Deleting it fails three of the four bootstrap cases.

Real-PostgreSQL API integration tests:

- `apps/api/integration/community-moderation-pipeline.integration.spec.ts` (21 cases): the passing, review, block, timeout, retry and idempotent redelivery branches against a migrated database, plus the tripwire that fails by name if `6.1-INT-060`'s backdated `updated_at` returns.

Gated real-model tests, which never run in a default suite:

- `apps/api/src/modules/community/community-content-screening.smoke.spec.ts` (9 gated cases, `RUN_COMMUNITY_SCREENING_SMOKE`): a real model load and a real classification with both network guards armed, then a check that both guards do throw so the first assertion is not vacuous, and all five `NsfwReadiness` fields checked against the real model.
- `apps/api/src/modules/community/community-content-screening.readiness.spec.ts` (10 cases, `RUN_COMMUNITY_SCREENING_READINESS`): corpus non-vacuity, duplicate-hash and manifest-integrity checks, that the corpus straddles the pass threshold so both dispositions are reachable from safe input alone, the Neutral band each fixture is pinned to, and the run product the evidence emitter consumes.

End-to-end tests:

- `playwright/tests/community-publication.spec.ts`: `6.2-E2E-01` uploads real bytes, confirms alt text, publishes and polls the author state through the full HTTP, storage, outbox, BullMQ, model and PostgreSQL path.
  `6.2-E2E-02` refuses a disallowed caption and proves the post never appears in another member's feed.
  `playwright/config/local-restricted.config.ts` disables trace, screenshot, video and the HTML reporter for the restricted run.
  `playwright/support/helpers/community-session.ts` deletes uploaded storage objects as well as database rows on pass or failure.

Evidence boundaries:

- **The test-architecture review has not returned.**
  Step 39 is written from the integrated code on `feat/epic6-story2` at `d3331d4f` while the story is `in-progress`, before the dedicated `bmad-tea` session has reviewed the test work or written its remediation tests.
  Nothing here has passed that gate.
- **`npm audit --omit=dev --audit-level=high` exits 1**, and it is item 8 of the story's own required command list.
  44 high or critical advisories remain in production scope.
  `--omit=dev` does not exclude them, because `expo` is a production dependency of `apps/mobile` and the OpenTelemetry packages are production dependencies of `apps/api`.
  Reaching exit 0 needs `expo@57`, OpenTelemetry majors, `next@16`, and accepting that `@nestjs/core` carries an advisory with no fixed version at any release.
  The security fixes that needed no breaking major did land: `sharp` 0.34.5 to 0.35.4, `next` 15.5.9 to 15.5.25, and the whole `@nestjs` set aligned to 11.2.3.
- **The vitest dependency graph cannot be satisfied, and that predates this story.**
  The lockfile carries three nested vitest versions alongside exact peer requirements no single hoisted vitest can meet, and `vitest-browser-react@0.3.0` peers on a range that excludes 4.x entirely.
  It resolves only because the lockfile was written in a state npm cannot reproduce.
  Repairing it requires taking `vitest-browser-react` to 2.3.0, which broke three mobile test files on the attempt, and it does nothing for the audit gate.
- **No tier proves the model detects anything.**
  No unsafe imagery may enter this repository.
  The unsafe branch is proved with class-probability vectors fed to the disposition function and with a fake inference runtime emitting an unsafe vector.
  The paired unsafe end-to-end journey is refused by the **text** screener, so it exercises no image refusal.
  That proves the policy and the transport.
  It does not show that the real model emits a high `Porn` or `Hentai` probability for genuinely unsafe input, and no synthetic vector can.
  Story 6.2b's corpus-backed measurement owns that link, and the readiness payload says so in those words.
- **The measurements are developer-laptop numbers.**
  Warm p95 26.64 ms, p99 31.21 ms, cold start 236.5 ms and peak RSS 339.4 MiB, over 1,000 warm inferences after 50 warmup passes on an Apple M4 Pro, from compiled output under plain `node`.
  Peak RSS is process-wide, because a worker thread shares its process with the supervisor.
  Use it for a container memory limit; it overstates the model's size.
  AC 8 still requires the real measurement on the named production target, which does not exist yet.
- **No hosted worker runs this code.**
  The repository still deploys no long-running BullMQ consumer.
  Task 5 made the process correct and proved it twice against local Docker Compose Redis and Supabase PostgreSQL, including a clean `SIGTERM` exit in around 100 ms.
  Story 6.2b builds and deploys the container.
- **Four integration flakes remain open in other epics' specs**, none reproducible in isolation: `weather.integration.spec.ts:363` returning 404 where 400 is correct, `wardrobe-silhouette.integration.spec.ts` cases `4.4-INT-15` and `4.4-INT-17` timing out under full-suite load, and `premium-revenuecat-webhook.integration.spec.ts` case `5.2-API-010` returning 404 where a row was expected.
  The one case chased to the bottom, `6.1-INT-060`, turned out to be shared-database interference.
  The last of the four has the same shape, so treat it as suspected interference too.
- **One verification could not be run by the session that owned it.**
  `test:tagging-model:smoke` fails wherever the 605 MB FashionCLIP model cannot be fetched.
  It passes here now that the download streams under a stall timeout, and that pass proves the `sharp` bump end to end through the transformers path.
- **Both production rollout flags stay false.**
  Seven of the eight Community Beta gate signatures remain open after Story 6.2b closes the model one: moderation staffing, SLA alerts, privacy, deletion, localization, accessibility, and rollback.

Architecture diagram:

```mermaid
flowchart TD
  subgraph Startup["Startup, before any job is consumed"]
    MAN["model manifest\npinned artifacts + WASM binaries\n6 SHA-256 hashes"] --> LOADER["policy loader\nhashes policy bytes\ncross-checks 5-key mirror\nderives engine identity"]
    LOADER --> SEL{"COMMUNITY_NSFW_SCREENER"}
    SEL -- "tensorflow" --> READY["ensureReady()\nverify hashes, setWasmPaths,\nin-memory IOHandler, warmup,\nvalidate 5 class names"]
    SEL -- "fixture (double-gated)" --> FIX["fixture adapter\nidentity ends -fixture"]
    SEL -- "unavailable + incident ref" --> UNAV["deterministic refusal\nscreening_unavailable"]
    SEL -- "absent or unknown" --> EXIT["exit before queue consumption"]
    READY --> LOG["readiness log\nidentity, backend, model hash,\nstartup ms. No absolute paths."]
  end

  LOG --> WORKER["BullMQ worker, concurrency 1\n3 attempts, exponential backoff"]
  FIX --> WORKER
  UNAV --> WORKER

  WORKER --> NORM["download, verify declaration,\norient, decode, strip metadata,\nre-encode, checksum"]
  NORM --> TEXT["CommunityTextScreener\ncaption + confirmed alt text\nALL 7 language lists, every submission"]
  NORM --> IMG["supervised worker thread\n1 inference in flight\n10s termination, 5s cooldown"]

  IMG --> EVAL{"three conditions, all required"}
  EVAL -- "Neutral > 0.85 AND\nunsafe sum < 0.10 AND\nno unsafe class > 0.35" --> IPASS["pass"]
  EVAL -- "unsafe class > 0.35" --> IBLOCK["block"]
  EVAL -- "boundary, malformed output,\nclass mismatch, sum invalid,\nlow confidence, timeout" --> IREVIEW["review"]

  TEXT --> TVERDICT{"severity to disposition\nlow, medium -> review\nhigh -> block"}
  TVERDICT --> COMBINE
  IPASS --> COMBINE{"combined verdict\nBOTH halves must explicitly pass"}
  IBLOCK --> COMBINE
  IREVIEW --> COMBINE

  COMBINE -- "both pass" --> PUB["published\nguarded pending_review update\naudit event + outbox stamp"]
  COMBINE -- "anything else" --> FLAG["flagged\nstable reason code\nunpublished, human review"]
  WORKER -- "3 attempts exhausted" --> RFAIL["review_failed\noutbox stamped"]

  PUB --> ID["moderation_engine_version\nadr013-text:policy-v1@hash;adr013-nsfw-...\nfixture runs say -fixture out loud"]
  FLAG --> ID
  RFAIL --> ID

  IMG -.-> GUARD["inside the worker, before any import:\nthrowing fetch AND\nthrowing net.Socket.prototype.connect"]
  READY -.-> MEASURE["measurements payload\nlabels the path that produced it\ngate = min(3x measured, ceiling)\nStory 6.2b renders the verdict"]
```

## Step 40: Community screening release gate and hosted worker

User/business impact:

Step 39 left a screener that could judge an image and a caption, ran on no hosted machine, and answered to a release gate this project could never close.
That gate asked for 400 licensed unsafe images, seven qualified native-language reviewers, three role signatures from one person, and a long-running worker the repository had never deployed.
Story 6.2b replaces each of those with something this project can measure, deploys the community worker as a container on Northflank, and builds one command that turns the measurements into a verdict.

At merge (`abfdf88a`, PR #151) that verdict reads `fail`.
Fourteen of the sixteen gates pass, including a canary against the deployed worker, which screened and published a safe fixture in 1,947 ms under policy v2.
Two gates fail and were left failing: the safe photograph holdout withholds 27 of 298 ordinary fashion photographs and blocks 7 of them, a Wilson 95% upper bound of 12.86% against a 5% gate, and the frozen clean-caption holdout withholds copy in Spanish, French, Italian and Portuguese.
No signature exists, the sign command refuses to approve a payload that does not recompute to `pass`, and both rollout flags stay false.
That 9.1% withheld rate is the review load the two beta moderators would inherit.

The same PR closed Story 6.2.
It added the runtime regression gate (`npm run community:screening:measure:gate`), gave authors localized copy for every stable moderation reason through `COMMUNITY_MODERATION_REASON_CATEGORY`, and proved it in the author's browser with `6.2-E2E-03`.

Key takeaways:

1. **Swap an unobtainable requirement for a measurable one, and write the trade down.**
   The spec's four-row substitution table names what each original requirement was for, what replaces it, and why the replacement is equivalent.
   Recall against real unsafe imagery is the upstream NSFWJS model's property, so it becomes a named limitation with a mitigation and a revisit condition.
   The code this repository owns, the path from class probabilities to a disposition, gets the exhaustive proof.
2. **Enumerate a small decision surface; sampling it leaves holes.**
   `community-screening-policy.sweep.spec.ts` walks the five-class simplex: every threshold from both sides, single-class maxima, ties, sum-tolerance edges, non-finite values, missing and duplicated class names, and the empty result.
   The payload records 10,852 vectors, every one mapped to exactly one disposition with a stable reason code, and every coverage block of the disposition function executed.
3. **Calibrate on one half and gate on the other, and split by the thing that correlates.**
   The safe corpus is 640 Openverse photographs from 199 creators, split by a hash of the creator key, with no creator above 5%.
   Policy v2's floor was chosen on the calibration split only.
   The manifest assigns 342 photographs to that split; the release payload records 341 evaluated calibration entries.
   The text gate runs on a clean holdout per language written after the allow list froze, and a failing holdout can only be fixed by a reviewed new holdout version.
4. **Evidence fails closed on staleness.**
   `scripts/lib/community-screening-input-set.mjs` hashes the screening and worker sources, policy, lists, manifests, corpora, Dockerfile, lockfile and measuring scripts.
   Every run product records that hash, and the generator reports a product with a different hash as not run.
   A dirty tree, a missing or partial measurement, or a hosted gate fed a local canary all keep the verdict from `pass`.
5. **One signature, bound to a hash, approved only when the gates say so.**
   `npm run community:screening:sign` records one owner verdict against the payload's SHA-256, and any regeneration makes it stale.
   The `--delegated` path lets an agent session record an approval only of a payload that recomputes to `pass` over the complete `MANDATORY_GATE_IDS` set, and never under `CI`.
6. **Shrink the dependency tree before choosing a host.**
   Swapping the union `@tensorflow/tfjs` for `tfjs-core`, `tfjs-converter` and the WASM backend, and pruning two unused model families, took the install from 325 MB to 98 MB with identical class probabilities.
   That opened the free hosts, and the image build now fails above 150 MB of `node_modules` (112 MB measured), so a dependency change fails the build before it reaches the bill.
7. **Prove presence with a heartbeat the worker owns.**
   Each worker process writes `community-worker:heartbeat:<worker name>:<instance id>` with a 90-second TTL refreshed every 30 seconds, and removes it first on shutdown.
   The canary, the restart drill and the Redis measurements count those keys by `SCAN`.
8. **Drain before closing, and nest the deadlines.**
   The bootstrap drains the BullMQ consumer, then closes the screener and PostHog, all inside one 20-second deadline.
   That sits under the launcher's 25 seconds, which sits under Northflank's default 30 seconds between `SIGTERM` and `SIGKILL`.
9. **Price the infrastructure inside the gate.**
   `redis-budget` projects the worker's month on Upstash Pay as You Go at 0.20 USD per 100K commands and passes at or below 5 USD.
   At merge that is 1.16 USD a month at 100 posts a day, inside the gate up to 818 posts a day.

Hard-won lessons from the implementation and code review of this story:

1. **The model calls real people `Drawing`.**
   The first measurement withheld 241 of 260 real fashion photographs (92.7%) under the Neutral-only rule, because NSFWJS puts most of a real photograph's probability on `Drawing`.
   Policy v2 passes on safe mass, `Neutral` plus `Drawing`, at 0.85.
   The first draft of that change quietly widened the joint unsafe bound from 0.15 to about 0.20; review finding BH5 caught it, and `Hentai + Porn + Sexy` stays below 0.15.
   With that bound, every floor at or below 0.85 withholds the same photographs, so the stricter tie-break ships.
2. **The sweep found a publish path on its first run.**
   A duplicated class name could overwrite the `Neutral` slot and publish.
   The screener now requires the exact class-name set, and the sweep keeps a case for it.
3. **The text holdout failed where the tuning half passed.**
   The in-sample clean half the allow list was built against withholds zero captions in every language.
   The frozen holdout withholds 1 in Spanish, 1 in French (blocked, on an ordinary verb form), 2 in Italian and 4 in Portuguese.
   The fix is a list change plus a new holdout version, recorded in `deferred-work.md`.
4. **The corpora found live text bypasses in Story 6.2's screener.**
   Five leet spellings published because classing created a doubled letter after the collapse, and a re-split phrase (`vai-tefoder`) slipped through.
   Leetspeak combined with a re-split phrase (`k1ll yours elf`) was a live self-harm bypass, fixed in this story although it predates it (EC5).
   The screener now also hashes every loaded list against `termsSha256` and `allowListSha256` and refuses to start on a mismatch.
5. **`sslmode=require` encrypts and checks nothing.**
   The canary's `pg` client dropped its CA whenever `DATABASE_URL` carried `sslmode=require` (CX1), and Prisma accepted any certificate under the same setting, shown against a TLS PostgreSQL signed by a test CA (RF3).
   The image now carries the Supabase Root 2021 CA at `/app/apps/api/certs/supabase-root-2021-ca.pem`, the hosted URL names it with `sslaccept=strict`, and the launcher refuses a production URL without both.
   The Vercel API still connects unverified, recorded in `deferred-work.md`.
6. **`SIGTERM` closed the model under a running job.**
   `performShutdown` closed the screener before the consumer drained, so stopping the container mid-screening failed the attempt with "Community NSFW screener is closing", and on a final attempt a valid post would land in `review_failed` (CX7).
7. **A crashed job could come back after the sweep had already failed its post.**
   A job holds its lock after its worker dies, and BullMQ requeues it on the stalled check after the one that marks it.
   At a 600-second check that is up to 1,200 seconds, past the 900-second stale-review sweep (RF13).
   The check is now 120 seconds, and `communityCrashRecoveryMs` puts recovery at 423 seconds against 1,323 at the old interval.
   `6.2b-INT-001` kills a real worker with `SIGKILL` mid-screening and fails at the old interval.
8. **Production found what no local run could: Upstash answers `CLIENT LIST` per node.**
   The hosted canary failed `worker_absent` twice against a healthy worker; measured against the production database, 5 of 12 fresh connections listed it (RF15).
   A local Redis is one node, so every local measurement agreed with itself.
   The same blind spot would have hidden a second consumer from the sole-consumer proof, which is why presence moved to heartbeat keys.
9. **An operations canary writes into production, so every public read has to exclude it.**
   The hosted canary first refused to run while the feed flag's code default or flag cache said on (RF5).
   `FeatureFlagsService.isEnabled` asks PostHog per viewer first, so a beta cohort could still read the feed, and against real PostgreSQL a published canary post led the feed and accepted a report (RF8).
   `PUBLICLY_VISIBLE_POST_WHERE` and `isPubliclyVisiblePost` in `community.repository.ts` now exclude `canary-user-` accounts from the feed, single-post, card-open and report reads.
10. **A write cut off by a client deadline can still commit.**
    A write cut off by the canary's deadline kept running and could commit after cleanup's `DELETE` while the report said `problems: []` (RF7).
    An empty lookup after a settle window still resolved an `INSERT` held 4 seconds by a trigger (RF10), and a dropped upload connection landed its object 1.5 seconds later (RF11).
    Cleanup now records unknown outcomes, cancels a cut-off write with `pg_cancel_backend` on the recorded `pg_backend_pid()`, and reports `uncertain` unless it sees the write end.
11. **The verdict code needs the same review as the code it judges.**
    The restart gate passed on any successful canary with no observed restart (RF1).
    The sign command trusted the payload's stored `verdict`, an editable field (RF6).
    A payload cut down to one passing gate recomputed to `pass` (RF9).
    Each now has a regression test that fails on the code before the fix.
12. **The Redis budget started from the wrong price list.**
    The gate assumed the free plan's 500,000 monthly commands, while `couturecast-prod` is on Pay as You Go with no free allowance.
    The idle cost then moved twice with correct fixes: 138 to 306 commands an hour when the stalled check dropped to 120 seconds, and 306 to 426 when the heartbeat added its 120 `SET`s an hour.
13. **Five image defects showed up only once the container ran.**
    The first prune trace dropped `reflect-metadata`, a peer `@nestjs/common` loads, and the first build generated the Prisma engine for OpenSSL 1.1.
    The worker also exited without `ANALYTICS_ID_SECRET`, and production's `warn` log level hid the readiness line.
    The build self-test now loads the whole consumer graph, the image sets `LOG_LEVEL=info`, and `tini -s` registers as a subreaper because Northflank runs its own PID 1.
14. **Authors saw raw validation codes.**
    The processor persists the code of the upload check it caught, and none of those codes was in the reason map, so web and mobile showed `Reason: IMAGE_CHECKSUM_MISMATCH` (RF12).
    A literal scan in the coverage test had missed them; `communityImageValidationCodeSchema` now names the six once, and each maps to a localized `upload` category.
15. **The admin retry re-screens nothing.**
    It adds a job named `retry` with a generated id, and the processor skips any post outside `pending_review`, so a `review_failed` post reports retried and stays failed (RF14).
    Comments and the runbook now say so; the end-to-end fix is in `deferred-work.md`.
16. **The local E2E stack could stop someone else's stack.**
    Playwright runs `globalTeardown` before stopping its web server, so the stack's community worker kept sweeping tables `db:reset` had just dropped.
    One shared pid file then let one checkout's teardown signal another's stack (CX8), and a reused pid could pass as a launcher (CX8b).
    The record now carries the OS start time and absolute launcher path, re-read from the live process before any signal.

Story/Task mapping:

- Task 1, the worker container: `apps/api/Dockerfile.community-worker`, `scripts/prune-community-worker-deps.mjs`, `scripts/start-community-worker-production.mjs`, `.dockerignore`.
- Task 2, deploy and canary: `scripts/community-screening-canary.mjs`, `scripts/lib/community-worker-heartbeat.mjs`, `scripts/lib/community-rollout-flags.mjs`, and the hosted worker section of `_bmad-output/project-knowledge/deployment-guide.md`.
- Task 3, policy-surface sweep: `community-screening-policy.sweep.spec.ts`, `apps/api/test/community-screening/policy-sweep-vectors.ts`, `disposition-coverage-probe.ts`.
- Task 4, safe corpus: `scripts/fetch-community-safe-corpus.mjs`, `scripts/calibrate-community-screening-models.mjs`, `apps/api/test/fixtures/community-safe-corpus/manifest.json`, `community-safe-corpus-holdout-triage.json`, and `policy-v2.json`.
- Task 5, text lists: `vendor/ldnoobw/`, `allow-list-v1.json`, `graded-overlay-v1/`, `scripts/verify-community-screening-lists.mjs`, `scripts/build-community-text-corpus.mjs`, and the corpora under `apps/api/test/fixtures/community-text-corpus/`.
- Task 6, evidence and signature: `scripts/generate-community-screening-readiness.mjs`, `scripts/sign-community-screening-readiness.mjs`, `scripts/lib/community-screening-input-set.mjs`, and the three measuring scripts.
- Task 7, quality gates: recorded under `Evidence boundaries`.
- Review fixes outside those tasks: the heartbeat (`community-worker-heartbeat.ts`), crash recovery (`community-moderation.worker.ts`), shutdown order (`community.bootstrap.ts`), canary exclusion (`community.repository.ts`), and E2E stack ownership (`scripts/e2e-stack-pid.mjs`, `playwright/global-teardown.ts`).

Story reference:

- `_bmad-output/implementation-artifacts/6-2b-community-screening-release-gate.md`, especially `The four substitutions`, the `Spec Change Log`, and the `Review Triage Log` with loops 1 to 7 (BH, EC, VG, CX and RF findings).
- `_bmad-output/test-artifacts/community-content-screening-model-readiness.json` and its rendered `.md`, which hold every measured figure; the spec, the guide and ADR-013 point there.
- `_bmad-output/test-artifacts/community-safe-corpus-holdout-triage.json`, a description of every withheld holdout photograph.
- `_bmad-output/planning-artifacts/architecture.md`, ADR-013 and its 2026-10-16 and 2026-10-17 amendments.
- `_bmad-output/implementation-artifacts/deferred-work.md`, the nine entries whose `source_spec` is the 6.2b spec.

Cross-links:

- Step 39 provides the screener, the policy loader, the supervised inference thread and the measurement payload this story deploys and judges.
- Step 38 provides the moderation outbox, the BullMQ pipeline, the stale-review sweep and the post visibility rule the canary exclusion extends.
- Step 5 provides the BullMQ queues whose stalled-job and idle-block settings this story tunes for cost and crash recovery.
- Step 4 provides the environment separation the hosted worker's variables and the strict database TLS follow.
- Step 7 provides the CI gates the sweep, list verification and gate-logic tests run in.

Sequence to follow:

1. Read the spec's `The four substitutions` and `Decision 3`; they explain why the proof moved from images to the policy surface.
2. Read `apps/api/policies/community-screening/policy-v2.json`, the `safeClasses` and `safeMassMinimum` rationales first.
3. Read `apps/api/src/modules/community/community-screening-policy.sweep.spec.ts` from its header, then `apps/api/test/community-screening/policy-sweep-vectors.ts`.
4. Read `scripts/generate-community-screening-readiness.mjs` around `wilsonInterval`, `MANDATORY_GATE_IDS`, `buildGates` and `verdictOf`, then `approvalRefusal` in `scripts/sign-community-screening-readiness.mjs`.
5. Open `_bmad-output/test-artifacts/community-content-screening-model-readiness.md` and read the gate table, the limitations and the Community Beta section.
6. Read `apps/api/Dockerfile.community-worker` top to bottom, then `scripts/start-community-worker-production.mjs` for what the launcher refuses.
7. Read `apps/api/src/modules/community/community-moderation.worker.ts` for `communityCrashRecoveryMs` and `communityModerationWorkerOptions`, then `apps/api/src/workers/community.bootstrap.ts` for `performShutdown`.
8. Read `apps/api/src/modules/community/community-worker-heartbeat.ts`, then the hosted worker section of `_bmad-output/project-knowledge/deployment-guide.md`.
9. Read `scripts/community-screening-canary.mjs` for the sole-consumer proof, the restart drill and unknown-outcome cleanup.

Task owner map:

- Story 6.2b container owner: build the pruned worker image, enforce the 150 MB budget and run as `node` under `tini -s` in `apps/api/Dockerfile.community-worker`.
- Story 6.2b dependency-trace owner: derive the worker's runtime tree from its import graph in `scripts/prune-community-worker-deps.mjs`.
- Story 6.2b launcher owner: verify model artifacts, refuse an unset or fixture selector and an unverified production database URL, and forward `SIGTERM` in `scripts/start-community-worker-production.mjs`.
- Story 6.2b canary owner: enqueue a safe fixture, prove the sole consumer, run the restart drill and resolve unknown outcomes in `scripts/community-screening-canary.mjs`.
- Story 6.2b heartbeat owner: write, refresh and remove the presence key in `apps/api/src/modules/community/community-worker-heartbeat.ts`, read by `scripts/lib/community-worker-heartbeat.mjs`.
- Story 6.2b crash-recovery owner: set the 120-second stalled check, lock and idle block in `apps/api/src/modules/community/community-moderation.worker.ts`.
- Story 6.2b shutdown owner: drain the consumer before closing the screener under one 20-second deadline in `apps/api/src/workers/community.bootstrap.ts`.
- Story 6.2b image policy owner: pass on safe mass with every unsafe bound held at v1 in `apps/api/policies/community-screening/policy-v2.json` and `apps/api/src/modules/community/tensorflow-nsfw-image-screener.ts`.
- Story 6.2b text list owner: vendor LDNOOBW at one commit and verify drift in `apps/api/policies/community-screening/vendor/ldnoobw/` and `scripts/verify-community-screening-lists.mjs`.
- Story 6.2b allow-list owner: record a reason per fashion exemption in `apps/api/policies/community-screening/allow-list-v1.json`.
- Story 6.2b corpus owner: fetch, split by creator and verify the safe photographs in `scripts/fetch-community-safe-corpus.mjs`, with calibration in `scripts/calibrate-community-screening-models.mjs`.
- Story 6.2b input-set owner: hash every input a run product depends on in `scripts/lib/community-screening-input-set.mjs`.
- Story 6.2b evidence owner: build the gates and the fail-closed verdict in `scripts/generate-community-screening-readiness.mjs`.
- Story 6.2b signature owner: record and verify the one owner verdict in `scripts/sign-community-screening-readiness.mjs`.
- Story 6.2b canary-visibility owner: exclude `canary-user-` accounts from every public read in `apps/api/src/modules/community/community.repository.ts`.
- Story 6.2b reason-copy owner: map every persisted moderation and upload code to a localized category in `packages/api-client/src/contracts/http/community.ts`.
- Story 6.2b E2E stack owner: record and check stack ownership in `scripts/e2e-stack-pid.mjs`, used by `scripts/start-api-e2e-with-workers.mjs` and `playwright/global-teardown.ts`.

Tests that cover this step:

`npm run lint`, `npm run typecheck` and `npm run validate` exited 0 per the spec's completion notes, with `apps/api` coverage at 95.1 statements, 89.17 branches, 95.64 functions and 95.28 lines against the 94/88/95/94 ratchet.
`npm run test:pw-local -- playwright/tests/community-publication.spec.ts` passed 3 of 3.
Those figures are reported by the implementing session and were not rerun for this step.

API unit tests:

- [`apps/api/src/modules/community/community-screening-policy.sweep.spec.ts`](../../apps/api/src/modules/community/community-screening-policy.sweep.spec.ts): the exhaustive policy-surface sweep, one disposition and reason code per vector, no pass without a confident safe mass, and full block coverage of the disposition function.
- [`apps/api/src/modules/community/community-text-corpus.evaluation.spec.ts`](../../apps/api/src/modules/community/community-text-corpus.evaluation.spec.ts): the in-sample clean half held at zero withheld and zero obfuscation bypasses per language in the ordinary suite; the frozen holdout gate runs under `npm run community:screening:text`.
- [`apps/api/src/modules/community/community-text-screener.spec.ts`](../../apps/api/src/modules/community/community-text-screener.spec.ts): regressions for the leet re-collapse, the re-split phrase in plain and leet form, and the list hash check at load.
- [`apps/api/src/modules/community/tensorflow-nsfw-image-screener.spec.ts`](../../apps/api/src/modules/community/tensorflow-nsfw-image-screener.spec.ts): the exact class-name set, safe mass, the joint unsafe bound, and `score` reporting safe mass.
- [`apps/api/src/modules/community/community-screening-policy.spec.ts`](../../apps/api/src/modules/community/community-screening-policy.spec.ts): the v2 schema and the list pins.
- [`apps/api/src/modules/community/community-worker-heartbeat.spec.ts`](../../apps/api/src/modules/community/community-worker-heartbeat.spec.ts): the heartbeat refreshes on a faked clock, expires on its TTL when refreshes stop, survives failing and silent Redis commands, and is removed on graceful shutdown.
- [`apps/api/src/modules/community/community-moderation.worker.spec.ts`](../../apps/api/src/modules/community/community-moderation.worker.spec.ts): the worker options, the commit-named worker and the crash-recovery budget.
- [`apps/api/src/modules/community/community-worker-runtime.spec.ts`](../../apps/api/src/modules/community/community-worker-runtime.spec.ts): the heartbeat wired on the worker's own BullMQ connection.
- [`apps/api/src/workers/community.bootstrap.spec.ts`](../../apps/api/src/workers/community.bootstrap.spec.ts): the worker drains before the runtime and telemetry close, and a job screening at `SIGTERM` finishes with its real disposition.
- [`apps/api/src/modules/community/community.repository.spec.ts`](../../apps/api/src/modules/community/community.repository.spec.ts): the public visibility predicate excludes `canary-user-` accounts.
- [`apps/api/src/modules/community/community.repository.reports.spec.ts`](../../apps/api/src/modules/community/community.repository.reports.spec.ts): a report on a canary post returns `post_not_visible`.
- [`apps/api/src/modules/community/community.repository.constraints.spec.ts`](../../apps/api/src/modules/community/community.repository.constraints.spec.ts): the alias race fixed along the way, where a `P2002` winner erased before the re-read returns null and a generated-alias collision still throws.

Gate-logic and tooling tests, run by the API integration config:

- [`apps/api/integration/community-worker-release-gate.spec.ts`](../../apps/api/integration/community-worker-release-gate.spec.ts): the refusal logic of every operations command, including the image budget, stale input sets, the hosted canary's commit and sole-consumer proof, the restart drill observations, unknown-outcome cleanup, SSL parameter stripping, the shutdown budgets inside the host grace, `MANDATORY_GATE_IDS`, `verdictOf` recomputation before any approval, and the Pay as You Go Redis price.
- [`apps/api/integration/e2e-stack-ownership.spec.ts`](../../apps/api/integration/e2e-stack-ownership.spec.ts): against real spawned processes and the real `ps`, a teardown signals only the stack its own checkout and port started, and a reused pid or a look-alike launcher path signals nothing.
- [`apps/api/integration/community-moderation-reason-codes.spec.ts`](../../apps/api/integration/community-moderation-reason-codes.spec.ts): every code the pipeline can persist, including the six image validation codes, has an author-facing category.

Real-infrastructure integration tests:

- [`apps/api/integration/community-moderation-crash-recovery.integration.spec.ts`](../../apps/api/integration/community-moderation-crash-recovery.integration.spec.ts): `6.2b-INT-001` kills a worker with `SIGKILL` mid-screening against real Redis and PostgreSQL, scales the timings down 60 times, and requires the post published before the scaled sweep.
- [`apps/api/integration/community-worker-heartbeat.integration.spec.ts`](../../apps/api/integration/community-worker-heartbeat.integration.spec.ts): `6.2b-INT-002` and `6.2b-INT-003` keep the key live across three TTLs, remove it at once on `SIGTERM`, and let it expire after `SIGKILL`.
- [`apps/api/integration/community-lifecycle.integration.spec.ts`](../../apps/api/integration/community-lifecycle.integration.spec.ts): a published canary post is never served or reportable, against real PostgreSQL.

Gated real-model tests, which never run in a default suite:

- [`apps/api/src/modules/community/community-safe-corpus.evaluation.spec.ts`](../../apps/api/src/modules/community/community-safe-corpus.evaluation.spec.ts): under `npm run community:screening:corpus:evaluate`, every holdout photograph takes the production normalization path and the real screener, and the run product feeds the `safe-corpus` gate.

Client and contract tests:

- [`packages/api-client/testing/community-contract.spec.ts`](../../packages/api-client/testing/community-contract.spec.ts): every stable code maps to one category, a moderator's free-text reason maps to none, and every category is used.
- [`apps/web/src/app/components/community-lookbook-grid.moderation.test.tsx`](../../apps/web/src/app/components/community-lookbook-grid.moderation.test.tsx): `6.2b-WEB-001` renders a persisted validation failure as localized copy.
- [`apps/mobile/src/screens/community-screen.test.tsx`](../../apps/mobile/src/screens/community-screen.test.tsx), with its cases in [`apps/mobile/src/test-utils/community-screen/moderation.cases.tsx`](../../apps/mobile/src/test-utils/community-screen/moderation.cases.tsx): `6.2b-MOB-001` does the same on mobile.
- [`apps/web/src/i18n/community-locales.spec.ts`](../../apps/web/src/i18n/community-locales.spec.ts) and [`apps/mobile/src/i18n/community-locales.spec.ts`](../../apps/mobile/src/i18n/community-locales.spec.ts): the reason category keys are derived from the enum in all ten catalogs.

End-to-end tests:

- [`playwright/tests/community-publication.spec.ts`](../../playwright/tests/community-publication.spec.ts): `6.2-E2E-03` refuses a caption and asserts the localized status, explanation and reason copy in the author's browser, in fixture and real-model mode.

Evidence boundaries:

- **Source-comment follow-up.**
  26 of the 26 linked source files in this test map lack a Step 40 cross-link comment in the reviewed Git snapshot.
  This document-only review leaves those source comments for a repository change.

- **The verdict is `fail`, and no signature exists.**
  The payload at `abfdf88a` fails `safe-corpus` and `text-clean-copy` and passes the other fourteen gates.
  The Community Beta model-readiness signature this story authorizes has not been recorded, and the payload's `communityBetaGate.remainOpen` lists seven more: moderation staffing, SLA alerts, privacy, deletion, localization, accessibility and rollback.
  The payload on `main` has been regenerated since by PR #162 and still reads `fail` on the same two gates.
- **The spec's checkboxes lag its own evidence.**
  The spec reads `done` with Task 2's Northflank deploy box and Task 7's hosted canary box unchecked, and a completion note saying the hosted canary waits on a redeploy.
  The last commit in the PR records the hosted canary for input set `26e38f3f` as passed, processed by `community-worker@73670667`, and the payload's `canary-hosted` gate reads `passed`.
  The payload is the current record.
- **No tier measures model recall.**
  An unsafe image the upstream model confidently reads as safe publishes automatically, and this repository has not measured how often.
  The mitigations are the conservative floor, the report action in Story 6.4, and both flags staying closed.
- **The hosted resource profile is assumed.**
  Latency (warm p95 305 ms) and memory (cgroup peak 338.2 MiB of 512 MiB at a 4096x4096 upload) were measured on a local container limited to 0.2 vCPU and 512 MiB.
  The payload's own `cpuSource` says to confirm that share against the Northflank sandbox plan, and its limitations list carries `hosted-measurement-pending`.
- **ADR-013 still says 600 seconds for the stalled check.**
  The amended ADR-013 on `main` says the community worker checks for stalled jobs every 600 seconds, while `COMMUNITY_MODERATION_STALLED_INTERVAL_MS` has been 120,000 since RF13.
  The worker's own 423-second recovery comment counts one 30-second stage and is deferred for correction because editing it forces a full re-measurement.
- **Open in `deferred-work.md`:** a dependency or image vulnerability scan (BH22), an external alert on the oldest `pending_review` age (BH18, Story 6.12), a stronger safe-for-work classifier to close the image gate, a new text holdout version, dropping dolls and rendered avatars from the corpus, OTLP export for the worker, strict TLS for the Vercel API, and an admin retry that re-screens.
- **Not reproduced here.**
  Every figure above comes from the payload, the spec or the commit bodies of PR #151; none was rerun for this step.

Architecture diagram:

```mermaid
flowchart TD
  subgraph Evidence["Release evidence, one command"]
    INPUTS["input-set hash\nsources, policy, lists, corpora,\nDockerfile, lockfile, scripts"] --> PRODUCTS["run products\neach records its input-set hash"]
    PRODUCTS --> GEN["generate-community-screening-readiness\nstale, dirty or partial -> not pass"]
    GEN --> GATES["16 gates = MANDATORY_GATE_IDS"]
    GATES --> VERDICT{"verdictOf(gates)"}
    VERDICT -- "at abfdf88a" --> FAIL["fail\nsafe-corpus 27/298 withheld\ntext holdout es, fr, it, pt"]
    VERDICT -- "pass only" --> SIGN["sign: one owner verdict\nbound to payload SHA-256\ndelegated only on pass, never CI"]
  end

  subgraph Proofs["What feeds the gates"]
    SWEEP["simplex sweep\n10,852 vectors"] --> PRODUCTS
    SAFE["640 photos, 199 creators\ncalibrate half, gate half"] --> PRODUCTS
    TEXT["LDNOOBW pinned + allow list\nfrozen clean holdout"] --> PRODUCTS
    CANARY["canary: local, restart drill, hosted"] --> PRODUCTS
    MEASURE["latency, memory, Redis USD"] --> PRODUCTS
  end

  subgraph Host["Northflank, 1 replica, concurrency 1"]
    IMG["Dockerfile.community-worker\n112 MB node_modules, node user, tini -s"] --> LAUNCH["launcher refuses: no selector,\nfixture, unverified DB TLS"]
    LAUNCH --> WORKER["community-worker@commit\nheartbeat key, 90s TTL"]
    WORKER --> STALL["stalled check 120s\nrecovery 423s < 900s sweep"]
    WORKER --> STOP["SIGTERM: drain consumer,\nthen screener, 20s < 25s < 30s"]
  end

  CANARY -. "SCAN heartbeat keys\nsole consumer before and after" .-> WORKER
  CANARY -. "canary-user- excluded\nfrom every public read" .-> FEED["Community feed\nflags stay false"]
```

## Step 41: Curated reactions

User/business impact:

A member can now react to a public look with one of three emoji the owner picked: Applaud (👏, `applause`), Love (❤️, `love`) and Inspired (✨, `inspiration`).
Each member holds at most one current reaction per post, authors included, and tapping the selected emoji removes it.
Every response carries all three counts, the total, the viewer's choice and a revision, read from one database snapshot, so the numbers on the card always add up.
Web and mobile render the same toggle controls with 44-pixel targets, pending and selected states, localized copy in all ten locales, and a selection haptic on mobile.

Adding or replacing a reaction needs authentication, age 13 or over, existing guardian consent under 16, and both community flags.
Removing one needs only authentication and the read flag, so a teen whose consent lapsed, or anyone during a posting freeze, can still take a vote back.
Consent revocation withdraws that member's counted votes atomically, erasure deletes reaction data, and a hidden post exposes no summary.
Production stays dark: both rollout flags remain false, and realtime, pushes, ranking and comments belong to later stories.

Merged as `989d1017` (PR #153), squashed from a branch whose spec, review logs and test artifacts record two review iterations, an independent Codex test review, a CodeRabbit pass and an independent web-agent review.

Key takeaways:

1. **Write the desired state, and fence it with a persistent revision.**
   `PUT /api/v1/community/posts/:postId/reaction` takes `{ selection | null, mutationId, baseRevision }` and sets the state the member wants.
   `CommunityReaction` keeps one row per `(user_id, post_id)` and keeps it after removal with `selection` null, so the revision survives a retraction.
   A delayed first attempt carries an old `baseRevision` and gets 409 with the current state, so it cannot restore a removed reaction.
2. **Bind retries to their payload.**
   `CommunityReactionReceipt` stores the post, selection and base revision under `(user_id, mutation_id)` for 30 days.
   The same mutation id with the same payload replays the current state without reapplying it or emitting analytics; with a changed payload it is a conflict.
   New mutation ids are capped at 60 per member per minute, and accepted retries bypass the quota.
3. **Read every number from one statement.**
   `reactionSummaries` in `community.repository.ts` builds counts, total, viewer choice, revision and generation in one SQL query, so the aggregate and the viewer state come from one MVCC snapshot.
   The same query applies the public visibility rule and excludes canary accounts.
4. **Negotiate new fields so installed clients keep parsing.**
   Installed apps parse the feed with strict schemas that reject extra fields.
   Feed and detail add `reactions` only when the request sends `x-couture-reactions: 1`, and every community response is `private, no-store` with `Vary` on that header, the platform header and `Authorization`.
5. **Put invalidation at the database boundary.**
   `LookbookPost.reaction_generation` advances inside the same transaction as every reaction write, every visibility or erasure change, and every cascade, through triggers in `20261018090000_add_community_reactions/migration.sql`.
   Reads stay uncached in this story; the migration header records the cache contract Story 6.6 must follow.
6. **Share one lock order across features that touch the same votes.**
   Reactions take the member advisory lock, then the post row lock.
   Guardian grants and revocations take the same member lock, and revocation runs at `ReadCommitted` so its snapshot starts after the lock is acquired and sees every committed vote.
7. **Keep remote calls outside database locks.**
   Feature flags resolve before the repository transaction opens; consent stays inside it, under the member lock.
   The analytics outbox claims a row with one autocommitted statement that sets a 30-second lease, delivers outside any transaction, then settles only where `lease_id` still matches.
8. **Count analytics as delivered only when the sink acknowledges it.**
   `PostHogService.captureAcknowledged` posts to PostHog's ingestion endpoint with the row's stable UUID and original occurrence time, and throws unless the response acknowledges it.
   A failed delivery backs off exponentially up to an hour and logs a safe reason, the attempt and the pending age, with no member id or payload.
9. **One screen-level coordinator owns every copy of a post's reaction.**
   `CommunityReactionState` in `packages/api-client/src/community-reaction-state.ts` holds confirmed summaries, pending intents and read fences per post for the whole screen.
   Cards, highlighted copies and the detail modal all render from it, so a card scrolling out of a list or a modal closing loses neither the result nor the retry payload.

Hard-won lessons from the implementation and code review of this story:

1. **Controls that owned their own request state lost results and fought each other.**
   Iteration 0 kept intent and busy refs inside each control.
   Closing the detail modal or virtualizing a card dropped an accepted result and its retry identity (BH5, CC3), and the web card and modal could both submit against one revision and conflict with themselves (BH6).
   Iteration 1 rebuilt ownership around the screen-level coordinator, with the iteration-0 source kept as a reference for the parts that worked.
2. **A late read can resurrect a post the server already hid.**
   A mutation 404 removed the visible copies, but a feed or detail read started earlier could finish later and reinsert the post (BH4).
   The coordinator now fences every read started before an eviction, and a later fresh read may re-establish visibility.
   The same family covered a delayed detail response overwriting a newer feed-confirmed reaction on mobile (EC1) and a native refresh that never updated the highlighted copy (EC2).
3. **Network calls inside a locked transaction stall everyone behind them.**
   Iteration 0 evaluated PostHog flags inside the member and post locks (CC2a), and the outbox held a row lock while calling HTTP and upserting telemetry through the root Prisma client (BH9, CC2b).
   On a one-connection pool the outbox waited on itself, and a slow sink consumed the transaction deadline and rolled back its own backoff update.
   `community-reaction-leases.integration.spec.ts` proves delivery on a one-connection pool, and that a stale worker cannot settle a reclaimed lease.
4. **A sweep needs a wall-clock budget, retention included.**
   Delivery originally ran 100 requests of up to three seconds each after moderation dispatch (BH8), and failures recorded backoff silently (BH10).
   The sweep now stops at a one-second budget plus one bounded send.
   Review iteration 1 found the two retention deletes ran after that deadline with no limit (R1-B4); they now run first in indexed batches of 100 per table.
5. **The aggregate join visited tombstones.**
   Persistent null-selection rows count zero but still joined into every aggregate (R1-B6).
   The join now filters `selection IS NOT NULL`, and the viewer revision subqueries still read the tombstones.
6. **A shared visibility predicate silently skipped checks for a caller that selected too little.**
   The report transaction selected status and publication fields but omitted the erasure and anonymization fields, and the predicate accepted undefined optionals, so reports skipped those checks (CC4b).
   The predicate now requires both fields, and `refuses a report while erasure is pending` runs against real PostgreSQL.
7. **Service tests that bypass the route cannot prove a route exemption.**
   The reaction route carries `@ConsentCheckedInTransaction()`, which tells `RequestAuthGuard` to skip its consent check because the handler checks consent under its lock.
   Deleting that metadata left every service and repository test green (VG1), and removing the `writeEnabled` guard did the same (R1-V1).
   `community-reaction-http.integration.spec.ts` now drives the real decorated route: a revoked teen can retract, cannot add, and a posting freeze refuses fresh adds and replacements.
8. **Accessible feedback broke in three small ways.**
   The web modal is `aria-modal`, so feedback sent only to the feed's live region was outside what a screen reader could reach (BH7).
   Two identical successes in a row left the live-region text unchanged, so React made no DOM change and nothing was announced (R1-B2, R1-E2); each confirmation now replaces a child node.
   Selected text fell below 4.5:1 in three of four palettes, Winter at about 2.25:1, and focus rings fell below 3:1 (BH1, BH2).
9. **A plural bug hid behind a compatibility flag, and its fix exposed a runtime gap.**
   The stronger native tests showed "1 reactions", because mobile i18next ran with `compatibilityJSON: 'v3'` and ignored the shipped `_one` and `_other` keys.
   Removing that option made iOS and the first Android CI run fail on a missing `Intl.PluralRules`, since Hermes in Expo SDK 54 lacks it.
   `apps/mobile/src/lib/intl-polyfills.ts` loads the FormatJS canonical-locales, locale and plural-rules polyfills in dependency order with data for all ten locales, and Babel needed the class-static-block transform for them.
10. **Parent identity updates did not cascade.**
    CodeRabbit found the reaction foreign keys lacked `ON UPDATE CASCADE`.
    A database identity-update probe failed on the original keys, and `20261019110000_cascade_community_reaction_identities/migration.sql` adds the six cascades as a forward migration, leaving the applied migrations untouched.
11. **An unexpected failure needs the same envelope as an expected one.**
    The final HTTP compatibility repair made `ApiExceptionFilter` turn any non-HTTP exception into the established three-field 500 envelope and log the original server-side.
    `community-privacy.http.spec.ts` checks that a synthetic database failure on the reaction route matches that shared contract.
12. **Device retries need the fixture reset too.**
    A CI watchdog retry ran the Maestro flow again against a member who still held the first attempt's reaction.
    The per-flow reset now clears the synthetic member's own reactions, receipts and outbox rows atomically with onboarding state, and refuses to run a retry when its reset wiring is missing or its reset fails.
13. **The independent test review asked for smaller files.**
    The Codex test review scored the supplied files 0 of 100 with 18 high findings, including seven oversized suites, while demonstrating no production defect.
    The repository, service, guardian, mobile screen, web grid, contract and Pact suites were split into focused files with their scenarios preserved; the largest resulting file is 599 lines.
14. **The installed Pact utility mis-maps Zod 3 integers.**
    `pactjs-utils` 1.1.0 turned integer checks into decimal matchers, and provider verification rejected six reaction interactions.
    The reaction summary now uses Pact's integer matchers directly, recorded as a documented fallback.

Story/Task mapping:

- Schema task: `packages/db/prisma/schema.prisma` and the three migrations `20261018090000_add_community_reactions`, `20261018100000_lease_community_reaction_outbox` and `20261019110000_cascade_community_reaction_identities`.
- Contract task: `packages/api-client/src/contracts/http/community.ts`, `packages/api-client/src/client.ts`, the regenerated `packages/api-client/docs/http.openapi.json` and `packages/api-client/src/generated/`.
- Repository and consent task: `apps/api/src/modules/community/community.repository.ts` and `apps/api/src/modules/guardian/guardian.service.ts`.
- Service and route task: `community.service.ts`, `community.controller.ts`, `community.module.ts`, `community-cache-headers.middleware.ts`, and `ConsentCheckedInTransaction` in `apps/api/src/modules/auth/security.decorators.ts`.
- Generation task: the triggers in `20261018090000_add_community_reactions/migration.sql`.
- Analytics task: `packages/api-client/src/types/analytics-events.ts`, `community-reaction.outbox.ts`, `apps/api/src/modules/telemetry/telemetry.service.ts`, `apps/api/src/posthog/posthog.service.ts`, and the sweep wiring in `community-worker-runtime.ts`.
- Client transport task: `apps/web/src/lib/community.ts`, `apps/mobile/src/lib/community.ts` and `packages/api-client/src/community-reaction-state.ts`.
- Surface task: `apps/web/src/app/components/community-reactions.tsx`, `community-lookbook-grid.tsx`, `apps/mobile/components/community/community-reactions.tsx` and `apps/mobile/src/features/community/community-screen.tsx`.
- Locale and fixture task: the ten catalogs under `apps/web/src/i18n/locales/` and `apps/mobile/assets/locales/`, and `packages/testing/src/factories/community.factory.ts`.
- Verification tasks: the test map below, `scripts/run-maestro.mjs`, `scripts/lib/mobile-e2e-flow-state.mjs` and `scripts/lib/mobile-e2e-flow-retry.mjs`.

Story reference:

- `_bmad-output/implementation-artifacts/spec-6-3-curated-reactions.md`, with its frozen intent and eight-row I/O matrix, the `Review Triage Log`, `Iteration 1 review`, and the post-build, Hermes, CodeRabbit and final-closure sections.
- `_bmad-output/test-artifacts/test-review/story-6-3-final-quality-gate.md`, the final local decision.
- `_bmad-output/test-artifacts/test-review/story-6-3-codex-peer.md` and `story-6-3-peer-disposition.md`, the independent test review and how each item closed.
- `_bmad-output/test-artifacts/automate/automation-summary-story-6-3-curated-reactions.md`, the test expansion and its mutation proofs.
- `_bmad-output/test-artifacts/test-review/story-6-3-web-agent.md`, the independent review of `0f288971` and its nine probes.

Cross-links:

- Step 38 provides the community feed, the post visibility rule, the API-only RLS posture and both clients this story extends.
- Step 40 provides the canary exclusion that `reactionSummaries` and the outbox repeat.
- Step 8 provides the analytics registry and the HMAC analytics subject the reaction events use.
- Step 18 provides the telemetry table the outbox upserts into before delivery.
- Step 22 provides the ten-catalog localization this story's plural repair runs through.
- Step 28 provides the accessibility baseline behind the live regions, focus contrast and 44-pixel targets.
- Step 33 provides the earlier server-side dedupe and HMAC privacy rules for commercial events.

Sequence to follow:

1. Read the frozen block at the top of the spec: the intent, the boundaries and the eight-row matrix.
2. Read `packages/db/prisma/migrations/20261018090000_add_community_reactions/migration.sql` from its header, then the lease migration.
3. Read `reactionSummaries` and `setReaction` in `apps/api/src/modules/community/community.repository.ts`, in that order.
4. Read `setReaction` in `apps/api/src/modules/community/community.service.ts`, then the reaction route in `community.controller.ts` with `ConsentCheckedInTransaction`.
5. Read the revocation transaction in `apps/api/src/modules/guardian/guardian.service.ts`, from the member lock to the `ReadCommitted` option.
6. Read `apps/api/src/modules/community/community-reaction.outbox.ts`, then `captureAcknowledged` in `apps/api/src/posthog/posthog.service.ts`.
7. Read the reaction schemas and `reconcileCommunityReactionItem` in `packages/api-client/src/contracts/http/community.ts`.
8. Read `packages/api-client/src/community-reaction-state.ts`, then find where `community-lookbook-grid.tsx` and `community-screen.tsx` construct it.
9. Read `apps/mobile/src/lib/intl-polyfills.ts` and the import at the top of `apps/mobile/src/lib/i18n.ts`.

Task owner map:

- Story 6.3 schema owner: own reaction state, receipts, outbox, RLS, generation and erasure triggers in `packages/db/prisma/migrations/20261018090000_add_community_reactions/migration.sql`, mirrored in `packages/db/prisma/schema.prisma`.
- Story 6.3 contract owner: own the reaction schemas, conflict and rate-limit messages, and the negotiated feed and detail shapes in `packages/api-client/src/contracts/http/community.ts`.
- Story 6.3 negotiation owner: send `x-couture-reactions: 1` when a client opts in, in `packages/api-client/src/client.ts`.
- Story 6.3 mutation owner: lock, check visibility, replay receipts, compare revisions, enforce the quota and enqueue analytics in `apps/api/src/modules/community/community.repository.ts`.
- Story 6.3 eligibility owner: resolve flags before locks and check age and consent inside them in `apps/api/src/modules/community/community.service.ts`.
- Story 6.3 route owner: validate the request, mark consent as checked in the transaction and set `Retry-After` in `apps/api/src/modules/community/community.controller.ts`.
- Story 6.3 cache-header owner: mark every community response private and vary it in `apps/api/src/modules/community/community-cache-headers.middleware.ts`.
- Story 6.3 consent-withdrawal owner: withdraw a teen's counted votes under the member lock in `apps/api/src/modules/guardian/guardian.service.ts`.
- Story 6.3 outbox owner: lease, deliver, settle and retain in `apps/api/src/modules/community/community-reaction.outbox.ts`, which already carries a `Story 6.3 owner` comment.
- Story 6.3 delivery owner: post acknowledged analytics with a stable UUID in `apps/api/src/posthog/posthog.service.ts`, called from `apps/api/src/modules/telemetry/telemetry.service.ts`.
- Story 6.3 client-state owner: own confirmed snapshots, intents and read fences per post in `packages/api-client/src/community-reaction-state.ts`.
- Story 6.3 web owner: render the controls in `apps/web/src/app/components/community-reactions.tsx` and coordinate them in `apps/web/src/app/components/community-lookbook-grid.tsx`.
- Story 6.3 mobile owner: render the controls in `apps/mobile/components/community/community-reactions.tsx` and coordinate them in `apps/mobile/src/features/community/community-screen.tsx`.
- Story 6.3 Hermes owner: polyfill plural rules before i18next loads in `apps/mobile/src/lib/intl-polyfills.ts`.
- Story 6.3 device-reset owner: reset a member's reaction state between flow attempts in `scripts/lib/mobile-e2e-flow-state.mjs` and `scripts/lib/mobile-e2e-flow-retry.mjs`.

Tests that cover this step:

The spec's final closure reports 6,303 passing workspace tests with ten existing intentional skips and unchanged coverage limits, deterministic Pact consumers at 116 mobile and 125 web interactions with provider verification passing, ten community RLS cases, nine browser journeys and a 220-second iOS community flow.
The squash commit reports all 30 PR checks green on the reviewed head.
Those are the implementing session's figures; they were not rerun for this step.

Shared contract and client-state tests:

- [`packages/api-client/testing/community-reaction-state.spec.ts`](../../packages/api-client/testing/community-reaction-state.spec.ts): shared confirmed snapshots across readers, read fences after a 404, one pending request that settles after its invoking child disappears, conflict reconciliation, and an identical failed payload kept for retry.
- [`packages/api-client/testing/community-reactions.spec.ts`](../../packages/api-client/testing/community-reactions.spec.ts): the closed palette, UUID identity and base revision, refusal of incoherent aggregates, strict installed schemas next to the negotiated ones, the documented 409, 429 and 500 envelopes, and header negotiation that leaves authentication and platform headers alone.
- [`packages/api-client/testing/community-openapi-contract.spec.ts`](../../packages/api-client/testing/community-openapi-contract.spec.ts): the generated SDK's 409 current state, 429 retry metadata and negotiated populated feed.
- [`packages/api-client/testing/community-analytics.spec.ts`](../../packages/api-client/testing/community-analytics.spec.ts): the added, replaced and removed reaction events and their privacy-safe properties.

Real-PostgreSQL database tests:

- [`packages/db/test/rls/community-posts.spec.ts`](../../packages/db/test/rls/community-posts.spec.ts): both client roles are refused every write verb on all three reaction tables, with no foreign-key oracle and no change to privileged state.

API unit and HTTP tests:

- [`apps/api/src/modules/community/community-privacy.http.spec.ts`](../../apps/api/src/modules/community/community-privacy.http.spec.ts): through the real `CommunityModule`, negotiated summaries stay private and per viewer, strict legacy projections survive, and 401, 403, 404, 409, 429 and 500 refusals all carry the private cache headers and their contracts.
- [`apps/api/src/modules/community/community.service.reactions.spec.ts`](../../apps/api/src/modules/community/community.service.reactions.spec.ts): flags resolve before the repository checks guardian state, retraction stays open during a write freeze and consent loss, refusals are localized, and hidden owner posts get no summary.
- [`apps/api/src/modules/auth/security.guards.spec.ts`](../../apps/api/src/modules/auth/security.guards.spec.ts): `RequestAuthGuard` still verifies authentication on a handler marked `ConsentCheckedInTransaction` and leaves the consent decision to its locked handler.
- [`apps/api/src/posthog/posthog.service.spec.ts`](../../apps/api/src/posthog/posthog.service.spec.ts): acknowledged delivery throws on an unconfigured key, a refused status, a quota-limited answer or a missing acknowledgement.
- [`apps/api/src/filters/api-exception.filter.spec.ts`](../../apps/api/src/filters/api-exception.filter.spec.ts): an unexpected exception becomes the shared three-field 500 envelope, and the original is logged.

Real-infrastructure integration tests, each on its own disposable database:

- [`apps/api/integration/community-reactions.integration.spec.ts`](../../apps/api/integration/community-reactions.integration.spec.ts): add, replace, retract, delayed first attempts, retained retries, the null-state revision, coherent batch snapshots under competing requests, the 60-id quota, and parent identity updates.
- [`apps/api/integration/community-reaction-concurrency.integration.spec.ts`](../../apps/api/integration/community-reaction-concurrency.integration.spec.ts): twelve members on one post with exact intermediate snapshots, one mutation id bound across posts, and no-change intent with no duplicate analytics.
- [`apps/api/integration/community-reaction-privacy.integration.spec.ts`](../../apps/api/integration/community-reaction-privacy.integration.spec.ts): age and consent refusals with retraction after consent loss, atomic vote withdrawal, revocation behind an in-flight reaction, visibility and erasure purges, member-scoped erasure on another author's post, and report refusal while erasure is pending.
- [`apps/api/integration/community-reaction-http.integration.spec.ts`](../../apps/api/integration/community-reaction-http.integration.spec.ts): the real guarded route for revoked-teen retraction, refused participation, and refused adds during a posting freeze.
- [`apps/api/integration/community-reaction-delivery.integration.spec.ts`](../../apps/api/integration/community-reaction-delivery.integration.spec.ts): stable insertion ids through recovery, delivery pending across real HTTP ingestion failures, capped retention batches, a one-connection pool released during slow delivery, expired-lease recovery, and delivery through the runtime sweep.
- [`apps/api/integration/community-reaction-leases.integration.spec.ts`](../../apps/api/integration/community-reaction-leases.integration.spec.ts): a stale worker cannot settle a reclaimed lease, two simultaneous sweeps deliver one claim, and isolated sweeps leave an unrelated row untouched.
- [`apps/api/integration/mobile-e2e-flow-state.integration.spec.ts`](../../apps/api/integration/mobile-e2e-flow-state.integration.spec.ts): the per-flow reset clears one member's reaction state, preserves another's, and rolls back every deletion and generation when a later deletion fails.
- [`apps/api/integration/mobile-e2e-flow-retry.spec.ts`](../../apps/api/integration/mobile-e2e-flow-retry.spec.ts): the runner resets before each attempt, refuses to run without reset wiring, stops when a reset fails, and allows two attempts at most.

Web component tests:

- [`apps/web/src/app/components/community-lookbook-grid.reactions.test.tsx`](../../apps/web/src/app/components/community-lookbook-grid.reactions.test.tsx): labeled toggles with card and detail in sync, repeated success announced on the active surface only, the 15-second malformed-conflict fallback retrying the original intent, confirmed counts kept on failure, and retraction after a write freeze.
- [`apps/web/src/app/components/community-lookbook-grid.request-ownership.test.tsx`](../../apps/web/src/app/components/community-lookbook-grid.request-ownership.test.tsx): the `6.3-WEB` cases for closing the modal during a PUT, serialized card and modal intents, feeds and details that arrive after a mutation or a 404, highlighted focus with announcements inside the modal, and open-modal eviction on refresh.

Mobile screen tests:

- [`apps/mobile/src/screens/community-screen.test.tsx`](../../apps/mobile/src/screens/community-screen.test.tsx), with its reaction cases in [`apps/mobile/src/test-utils/community-screen/reactions.cases.tsx`](../../apps/mobile/src/test-utils/community-screen/reactions.cases.tsx): `6.3-MOB-001` to `6.3-MOB-028` cover add, replace and retract with focusable labeled controls, a failed first PUT retried with the exact payload, delayed details and older feeds that cannot overwrite or resurrect, the highlighted deep-link copy, the post-await filter check, wrapping controls, and singular text.
- [`apps/mobile/src/lib/intl-polyfills.test.ts`](../../apps/mobile/src/lib/intl-polyfills.test.ts): with the native `Intl` APIs removed, the real polyfills load and resolve plural categories.
- [`apps/mobile/src/lib/i18n.test.ts`](../../apps/mobile/src/lib/i18n.test.ts): the shipped plural forms per locale, starting with `1 reaction` and `2 reactions` in `en-US`.

Pact contract tests:

- [`pact/http/consumer/web-api-client.pacttest.ts`](../../pact/http/consumer/web-api-client.pacttest.ts) and [`pact/http/consumer/mobile-api-client.pacttest.ts`](../../pact/http/consumer/mobile-api-client.pacttest.ts): both consumers' reaction, negotiated feed, 409 and 429 interactions, defined in `pact/http/consumer/interactions/community/reactions.ts`.
- [`pact/http/provider/api-provider.pacttest.ts`](../../pact/http/provider/api-provider.pacttest.ts): replays those contracts against the real controllers with the community provider doubles and states.

Playwright end-to-end tests:

- [`playwright/tests/community-reactions.spec.ts`](../../playwright/tests/community-reactions.spec.ts): keyboard add, replace, reload persistence and retraction with each palette count and the total asserted, retry of the same intent after a network failure, highlighted focus and modal announcements with contrast in every theme, feed order around a highlighted card, and the axe audit.

Mobile end-to-end test:

- [`maestro/community-feed.yaml`](../../maestro/community-feed.yaml): add, replace, relaunch persistence and removal with exact singular and plural text and visible count deltas, on iOS.

Evidence boundaries:

- **Source-comment follow-up.**
  29 of the 29 linked source files in this test map lack a Step 41 cross-link comment in the reviewed Git snapshot.
  This document-only review leaves those source comments for a repository change.

- **Every execution log lives in `/tmp` on the implementing machine.**
  The spec and test artifacts cite logs such as `/tmp/couture63-no-debt-validate.log`; none is in the repository, and none was read for this step.
  The counts above are as reported.
- **Android and physical-device haptics were not exercised.**
  The Maestro evidence is an iOS Simulator run with `MOBILE_E2E_EXPO_NO_OPEN=1`, because Simulator.app lookup failed on that machine while `simctl` worked.
- **Reads are uncached.**
  The generation column and its triggers exist, and the migration header states the contract a future cache must follow; no cache consumes them yet.
- **Three review findings were rejected with a stated residual risk.**
  An older owner omission can briefly clear a newer public snapshot until the next read (R1-B1).
  A slow moderation Redis can delay reaction delivery, because reaction dispatch runs after moderation dispatch in the same sweep (R1-B5).
  Stale attempts and accepted replays still take the hot-post lock, and a request flood needs a separate abuse policy (R1-B7).
- **Production stays dark.**
  Both migrations are applied locally only, no deployment occurred, and `community_read_enabled` and `community_write_enabled` remain false.

Architecture diagram:

```mermaid
flowchart TD
  subgraph Client["Web grid or mobile screen"]
    CTRL["Reaction controls\naria-pressed, 44px, haptic"] --> COORD["CommunityReactionState\none per screen"]
    COORD -- "selection or null,\nmutationId, baseRevision" --> PUT["PUT /community/posts/:id/reaction"]
    READS["feed and detail\nx-couture-reactions: 1"] --> COORD
    COORD -. "read fence on 404\nkeep higher revision or generation" .-> CTRL
  end

  PUT --> FLAGS["resolve flags first\nno locks held"]
  FLAGS --> TX["one transaction"]

  subgraph DB["PostgreSQL, API-only tables"]
    TX --> LOCKS["member advisory lock,\nthen post FOR UPDATE"]
    LOCKS --> CHECK{"visible? receipt? revision?"}
    CHECK -- "receipt, same payload" --> REPLAY["return current state"]
    CHECK -- "stale revision or changed payload" --> CONFLICT["409 with current state"]
    CHECK -- "fresh" --> WRITE["upsert reaction, revision + 1\nreceipt row, outbox row"]
    WRITE --> GEN["trigger: reaction_generation + 1"]
    WRITE --> SNAP["one-statement summary\ncounts, total, viewer, revision"]
    REVOKE["guardian revocation\nsame member lock, ReadCommitted"] --> WITHDRAW["selection null, revision + 1"]
    ERASE["visibility or erasure change"] --> GEN
  end

  subgraph Sweep["Community worker sweep"]
    CLAIM["claim one row\n30s lease, autocommit"] --> SEND["acknowledged PostHog POST\nstable UUID, occurrence time"]
    SEND --> SETTLE["settle where lease_id matches\nor back off up to 1h"]
  end

  WRITE -.-> CLAIM
```

## Step 42: Screened threaded comments

User/business impact:

Members can now talk about a look.
A member writes a comment of 1 to 280 characters, or replies one level under a root, and sees it as private `pending_screening` until the standalone worker screens it.
A passing comment publishes once, in a stable order, on web and mobile.
A held, blocked or failed comment stays visible to its author only, with a status and recovery copy, and it creates a durable moderation record.
Every visible entry carries a Report action, and a successful report response means the moderation intake row already exists.
Author deletion, guardian consent revocation and account erasure all clear the text and keep the thread readable through placeholders.
Production stays dark: `community_read_enabled` and `community_write_enabled` remain false.

Key takeaways:

1. **Publication order is assigned under the post lock.**
   The worker increments `LookbookPost.comment_publication_sequence` inside the publishing transaction and stamps it on the comment.
   Every cursor carries a snapshot watermark and the last sequence it returned, so a comment that finishes screening late lands above the snapshot.
   Traversal sees each published item once, and `hasNewer` tells the client a refresh will show more.
2. **Private submissions live on their own endpoint.**
   `GET /comment-submissions` pages the caller's own rows by `created_at,id`.
   Public pages hold published items and tombstones only.
   The client reconciles the two lists by comment id, so a newly published comment appears once.
3. **A create UUID is bound to its payload.**
   `CommunityCommentReceipt` stores a SHA-256 over post, parent, body and locale.
   An exact replay returns the stored submission, even after deletion, and skips the quota.
   A changed payload under the same UUID returns 409.
4. **A report commits its own moderation intake.**
   The report transaction writes `accepted_at`, `routed_at` and a 24-hour `sla_due_at` together.
   A database check constraint pins `routed_at` to within five minutes of acceptance, so the five-minute requirement has no asynchronous gap to test.
5. **One lock order everywhere.**
   Writes take the `community_member:` advisory lock, then the post row `FOR UPDATE`.
   Reads take the shared variants of both.
   Reports add the `community_report:` lock, shared with post reports, so one rolling quota of 50 per 24 hours covers both.
   `CommunityCommentsService` resolves both flags first, then hands the repository a closure that checks age and guardian consent inside the locked transaction.
6. **The database enforces the thread shape.**
   A trigger refuses a parent that is not a same-post root and refuses any change to `post_id` or `parent_id`.
   A check constraint clears the body for `author_deleted`, `consent_suspended` and `erased`.
   A second trigger turns a direct `User` deletion into an erased comment in the same statement.
7. **Redis carries identifiers only.**
   A comment job holds `commentId` and `generation`, and its BullMQ id is `comment__<id>__<generation>`.
   Deferring work during a posting freeze bumps the generation, which makes every older job a no-op.
8. **Web and mobile share one request-ownership model.**
   `packages/api-client/src/community-comments-state.ts` gives each request a ticket over a session generation and a per-post fence.
   A late response from a reset session or an evicted post is dropped.
   An unsent create keeps its UUID and body until the server gives a definite answer.

Hard-won lessons from the implementation and code review of this story:

1. **A fallback cache is a poor rollout switch.**
   The first worker checked the flag rows that `syncFlags` writes under a synthetic distinct id.
   A member targeted true in a cohort rollout could never publish, because the synthetic identity read false.
   The Opus review traced the cache owner, the fix removed the cache checks, and per-author `FeatureFlagsService` evaluation is the only authority (B6, O-B1).
   An earlier proposed global gate was withdrawn for the same reason (B7).
2. **A posting freeze used to fail queued comments for good.**
   Three thrown freeze errors reached `markFailed`, and the stale sweep failed every old pending row regardless of rollout, which would have flooded moderation intake (O-B2).
   The processor now defers by bumping the outbox generation.
   Two follow-ups closed the gaps that change opened: `markFailed` compares the job generation under lock (P3), and the stale sweep applies the outbox freshness predicate when it selects candidates, so 100 frozen rows cannot starve the rest (P4).
3. **A definite rejection wedged the composer.**
   The client kept the rejected body and parent as the immutable retry payload, so editing the draft still resent the refused request (B1, E2, O-H1).
   A definite 4xx now releases the attempt.
   A timeout, network error or 5xx keeps the exact UUID and body.
4. **One fence for reads and mutations was too coarse.**
   A successful delete bumped the post fence after its response, so a second delete, an accepted create or a report confirmation on the same post was discarded as stale (B2, E1, O-M5).
   Delete now invalidates outstanding reads and leaves independent mutations alone.
5. **Public-id dedupe hid a suppression.**
   Reconciliation dropped every private row whose id was already public, so an `author_deleted` or `consent_suspended` status left the cached body and alias on screen (B4, E3).
   Authoritative suppression now applies before dedupe.
6. **An analytics row could outlive the erasure of its subject.**
   Delivery leased a row into memory and sent it after erasure had deleted the subject (B5, E4).
   Delivery now holds `FOR KEY SHARE` on `CommunityCommentAnalyticsSubject` for the whole transaction, and both race orderings are tested against PostgreSQL.
7. **Author deletion erased the evidence.**
   The first delete cleared every report snapshot, so an author could wipe the record of reported abuse (O-M2).
   Ordinary deletion keeps accepted snapshots, and only erasure and consent loss scrub them.
8. **Polling ran with nothing to poll.**
   Both surfaces polled every three seconds with nothing pending, and every failed poll announced again (O-M4).
   `watchSubmissions` now polls only while a `pending_screening` row exists, backs off to 30 seconds, and announces an error transition once.
   Its timer then survived a reset and polled the old post (T2).
   The first fix stopped the mounted watch from polling the next account, and a second fix tied timer ownership to each scheduling cycle (T3).
9. **An unbound supertest server can answer for another suite.**
   Passing an unlistened Nest server lets supertest pick a dual-stack port that can collide with a live IPv4 fixture on macOS, which produced the RevenueCat wrong-responder failures (O-M10).
   A shared loopback helper binds once to `127.0.0.1:0`, and fifteen existing integration suites moved to it; it now lives at `apps/api/src/testing/loopback-http-app.ts`.
10. **Rotating the analytics secret broke a returning member.**
    The outbox wrote the actor derived from the new secret, while the subject row still held the old one, and create returned 500.
    Outbox events now use the durable actor returned from the subject upsert.
11. **A passing device flow can still hide the primary button.**
    The Android Maestro flow passed while Gboard covered the Send button; a manual screenshot read found it (P6).
    `apps/mobile/components/community/community-comments-sheet.tsx` now offsets the keyboard by `StatusBar.currentHeight` on Android.
    The same pixel pass on web measured dark-scheme text at 1.06:1 and the focus outline at 1.09:1; the fixed outline measures 17.34:1.
12. **CodeRabbit stops at 100 files.**
    PR #154 changed 150 files, so CodeRabbit reviewed it through two temporary PRs, #155 for backend and #156 for clients.
    That review found the shared report quota computing an early `Retry-After` once history exceeded the cap (CR4) and a no-cursor append stealing request ownership from an in-flight refresh (CR6).
13. **Three CI flakes outside the story were fixed on the way.**
    The Expo Go installer unlinked a redirect target while opening the same path (P7).
    The Story 6.3 reaction spec matched two `Close this look` buttons once comments added a second one (P8).
    Maestro's centred scroll search rejected a control it had measured fully visible (P10, P12).

Story/Task mapping:

The spec lists its nine execution items without numbers; they are numbered here in spec order.

- Task 1, schema and migrations: `packages/db/prisma/schema.prisma`, `packages/db/prisma/migrations/20261019000000_threaded_comments/migration.sql`, `packages/db/prisma/migrations/20261019000001_threaded_comments_invariants/migration.sql`.
- Task 2, contracts and SDK: `packages/api-client/src/contracts/http/community.ts`, `packages/api-client/src/client.ts`, `packages/api-client/src/generated/apis/CommunityApi.ts`, `packages/api-client/docs/http.openapi.json`.
- Task 3, API routes, eligibility, paging, replay and report intake:
  - `apps/api/src/modules/community/community-comments.controller.ts`
  - `apps/api/src/modules/community/community-comments.service.ts`
  - `apps/api/src/modules/community/community-comments.repository.ts`
  - `apps/api/src/modules/community/community-report-limit.ts`
- Task 4, queue, outbox and worker:
  - `apps/api/src/modules/community/community-moderation.queue.ts`
  - `apps/api/src/modules/community/community-comments.outbox.ts`
  - `apps/api/src/modules/community/community-comments.processor.ts`
  - `apps/api/src/modules/community/community-moderation.worker.ts`
  - `apps/api/src/modules/community/community-worker-runtime.ts`
  - `apps/api/src/workers/community.bootstrap.ts`
- Task 5, consent, erasure and analytics:
  - `apps/api/src/modules/guardian/guardian.service.ts`
  - `apps/api/src/modules/guardian/guardian-participation.ts`
  - `apps/api/src/modules/community/community-comments.privacy.ts`
  - `apps/api/src/modules/telemetry/telemetry.service.ts`
  - `packages/api-client/src/types/analytics-events.ts`
- Task 6, shared client state: `packages/api-client/src/community-comments-state.ts`, `apps/web/src/lib/community.ts`, `apps/mobile/src/lib/community.ts`.
- Task 7, user interfaces:
  - `apps/web/src/app/components/community-comments.tsx`
  - `apps/web/src/app/components/community-lookbook-grid.tsx`
  - `apps/web/src/app/components/accessible-modal.tsx`
  - `apps/mobile/components/community/community-comments-sheet.tsx`
  - `apps/mobile/components/community/community-card.tsx`
  - `apps/mobile/src/features/community/community-screen.tsx`
- Task 8, locales and fixtures: the ten catalogs under `apps/web/src/i18n/locales/` and `apps/mobile/assets/locales/`, `packages/testing/src/factories/community.factory.ts`, `packages/testing/src/community-comments-cleanup.ts`.
- Task 9, verification: every file in the test map below.

Story reference:

- `_bmad-output/implementation-artifacts/spec-6-4-threaded-comments.md`, whose Review Triage Log classifies every finding and whose Verification section records each run.
- `_bmad-output/implementation-artifacts/6-4-threaded-comments-design.md` for the lifecycle states, limits, locking and privacy decisions.
- `_bmad-output/implementation-artifacts/reviews/story-6-4-opus-implementation-review.md`, `_bmad-output/implementation-artifacts/reviews/story-6-4-coderabbit-backend-review.md` and `_bmad-output/implementation-artifacts/reviews/story-6-4-coderabbit-frontend-review.md`.
- `_bmad-output/test-artifacts/automate/automation-summary-story-6-4-threaded-comments.md` and `_bmad-output/test-artifacts/test-review/test-review-story-6-4-threaded-comments.md`.
- Merged as `aa8cd0e1` (PR #154).

Cross-links:

- Step 38 for the visibility predicate, the member-before-post lock order, post reports and the API-only RLS posture that comments reuse.
- Step 39 for `CommunityTextScreener` and the standalone worker; comments are screened as field `caption` under the unchanged pinned policy.
- Step 41 (Story 6.3, curated reactions) for the reaction outbox whose content-free warning shape the comment outbox copies, and for the reaction browser spec this story had to repair.
- Step 28 for the focus, live-region and 44-pixel target baseline.
- Step 22 for the ten-locale parity checks.

Sequence to follow:

1. `packages/db/prisma/migrations/20261019000001_threaded_comments_invariants/migration.sql`: RLS on all seven comment tables, `valid_comment_body`, the publication and hidden-body checks, the five-minute routing check, the thread trigger and the append-only audit trigger.
2. `packages/api-client/src/contracts/http/community.ts`: the comment, submission, page and report schemas and the cursor shape.
3. `apps/api/src/modules/community/community-comments.repository.ts`: `withThread` and its two lock modes, snapshot paging, receipt replay, the 60-per-minute and 200-per-day windows, delete and the report transaction.
4. `apps/api/src/modules/community/community-comments.processor.ts`: the two rollout checks around screening, the locked recheck of post, consent and root, the sequence increment, and `markFailed`.
5. `apps/api/src/modules/community/community-comments.outbox.ts` and `apps/api/src/modules/community/community-moderation.queue.ts`: dispatch backoff, the deterministic job id, the 15-minute stale sweep, and leased analytics delivery.
6. `apps/api/src/modules/guardian/guardian.service.ts` and `apps/api/src/modules/community/community-comments.privacy.ts`: consent suspension in the revocation transaction and erasure cleanup.
7. `packages/api-client/src/community-comments-state.ts`: tickets, fences, the immutable retry, reconciliation and `watchSubmissions`.
8. `apps/web/src/app/components/community-comments.tsx` and `apps/mobile/components/community/community-comments-sheet.tsx`: the two surfaces.

Task owner map:

The code carries unnumbered `Story 6.4 owner:` anchors; each bullet quotes the anchor text so it stays searchable.

- Schema owner, "API-only isolation and cross-row privacy invariants": `packages/db/prisma/migrations/20261019000001_threaded_comments_invariants/migration.sql`
- Route owner, "validated independent comment routes": `apps/api/src/modules/community/community-comments.controller.ts`
- Thread owner, "member/post serialized threads and synchronous moderation intake": `apps/api/src/modules/community/community-comments.repository.ts`
- Report quota owner, "one rolling abuse ledger for post and comment reports": `apps/api/src/modules/community/community-report-limit.ts`
- Screening owner, "worker-only text screening with guarded publication": `apps/api/src/modules/community/community-comments.processor.ts`
- Outbox owner, "comment work shares the existing worker and PostgreSQL sweeps": `apps/api/src/modules/community/community-comments.outbox.ts`
- Eligibility owner, "one database eligibility rule shared by requests and publication": `apps/api/src/modules/guardian/guardian-participation.ts`
- Erasure owner, "immediate account-erasure cleanup within the authoritative transaction": `apps/api/src/modules/community/community-comments.privacy.ts`
- Client state owner, "screen-owned drafts, immutable retries, page merge and visibility fences": `packages/api-client/src/community-comments-state.ts`
- Web owner, "accessible comments inside the existing look detail dialog": `apps/web/src/app/components/community-comments.tsx`
- Mobile owner, "independently focusable native thread controls and modal feedback": `apps/mobile/components/community/community-comments-sheet.tsx`
- Device journey owner, "real native compose, keyboard, draft reopening and private status": `maestro/community-comments.yaml`
- Integration harness owner, "one disposable database, service graph and HTTP boot per comment spec file": `apps/api/integration/helpers/community-comments-context.ts`

Tests that cover this step:

The map says what each test asserts.
Execution counts and logs are in the spec's Verification section and the automation summary; see Evidence boundaries for which numbers were reproduced here.

Shared client and contract tests:

- [`packages/api-client/testing/community-comments-state.spec.ts`](../../packages/api-client/testing/community-comments-state.spec.ts): proves tickets, fences, eviction, reset, page merge, suppression before dedupe, and `watchSubmissions` polling, backoff and cancellation across account switch.
- [`packages/api-client/testing/community-comments-state-outcomes.spec.ts`](../../packages/api-client/testing/community-comments-state-outcomes.spec.ts): proves that definite 400, 403, 409 and 429 answers release the retry while uncertain outcomes keep the exact UUID and body, and the exact error keys including `age_gate`.
- [`packages/api-client/testing/community-comments-client.spec.ts`](../../packages/api-client/testing/community-comments-client.spec.ts): proves every thread operation goes through the generated authenticated boundary on both platforms, private fields are refused, and a timed-out fetch releases while the draft and retry survive.
- [`packages/api-client/testing/community-openapi-contract.spec.ts`](../../packages/api-client/testing/community-openapi-contract.spec.ts): proves each of the six comment operations documents its reachable 500 (CR7).

Database tests:

- [`packages/db/test/rls/community-posts.spec.ts`](../../packages/db/test/rls/community-posts.spec.ts): `6.4-DB-RLS` proves `anon` and `authenticated` are refused on all seven comment tables.

Fixture tests:

- [`packages/testing/test/community-comments-fixtures.spec.ts`](../../packages/testing/test/community-comments-fixtures.spec.ts): proves the public, private, reply and tombstone fixtures, and that cleanup removes only selected rows and keeps a root another member replied to.

API unit tests:

- [`apps/api/src/modules/community/community-comment-worker-errors.spec.ts`](../../apps/api/src/modules/community/community-comment-worker-errors.spec.ts): proves the original screening error survives a rejecting final `markFailed` and that settlement waits while a retry remains (CR3).
- [`apps/api/src/modules/community/community-comments.outbox.spec.ts`](../../apps/api/src/modules/community/community-comments.outbox.spec.ts): proves enqueue and delivery failures log reason, attempt and age with no content or identity, and leave the lease recoverable (O-M7).
- [`apps/api/src/modules/community/community-worker-runtime.spec.ts`](../../apps/api/src/modules/community/community-worker-runtime.spec.ts): proves comment sweeps run in isolation from post and reaction sweeps and that failures surface by step name (O-M8, CR5).

Real-PostgreSQL and Redis integration tests:

- [`apps/api/integration/community-comments-http.integration.spec.ts`](../../apps/api/integration/community-comments-http.integration.spec.ts): proves the guarded routes, exact error envelopes, malformed paging, lone-surrogate 400, a revoked teen who can still read, delete and report, the shared report `Retry-After`, and the durable analytics actor after secret rotation.
- [`apps/api/integration/community-comments-threads.integration.spec.ts`](../../apps/api/integration/community-comments-threads.integration.spec.ts): proves snapshot paging under concurrent publication, one-level nesting, tombstones, and JavaScript-to-database Unicode parity.
- [`apps/api/integration/community-comments-replay-quota.integration.spec.ts`](../../apps/api/integration/community-comments-replay-quota.integration.spec.ts): proves the minute and day windows on a pinned clock, private paging, exact replay, changed-payload 409 and concurrent receipts.
- [`apps/api/integration/community-comments-reports.integration.spec.ts`](../../apps/api/integration/community-comments-reports.integration.spec.ts): proves intake, audit, snapshot and the five-minute bound commit together, the audit stays append-only, a snapshot survives author deletion (O-M2), and post and comment reports share one quota.
- [`apps/api/integration/community-comments-privacy.integration.spec.ts`](../../apps/api/integration/community-comments-privacy.integration.spec.ts): proves suspension inside the revocation transaction, no text restored on a later grant, a delayed screening result fenced against revocation and a freeze, and erasure or direct deletion scrubbing comments, receipts, snapshots and outbox rows.
- [`apps/api/integration/community-comments-recovery.integration.spec.ts`](../../apps/api/integration/community-comments-recovery.integration.spec.ts): proves an immediate first dispatch then the exact 30-second backoff (CR1), a 16-minute row failing once while a 14-minute row stays pending, and a sweep that respects an outbox refreshed under its lock.
- [`apps/api/integration/community-comments-worker.integration.spec.ts`](../../apps/api/integration/community-comments-worker.integration.spec.ts): proves the real BullMQ worker publishes once, keeps frozen work private past retries and stale age, exhausts into one intake and audit row, honours generation rearm, and progresses past 100 frozen rows (V2, P3, P4).
- [`apps/api/integration/community-comments-delivery.integration.spec.ts`](../../apps/api/integration/community-comments-delivery.integration.spec.ts): proves real snake_case telemetry retried as one stable event until the sink acknowledges (V1), and that erasure and delivery cannot interleave in either order (B5).
- [`apps/api/integration/community-comments-rollout-cleanup.integration.spec.ts`](../../apps/api/integration/community-comments-rollout-cleanup.integration.spec.ts): proves the worker honours a per-author rollout while the synthetic fallback cache reads false, cleanup leaves no orphaned reply, and an identifier-only job runs through real Redis once (O-B1, O-LM7).
- [`apps/api/integration/community-comments-measurement.integration.spec.ts`](../../apps/api/integration/community-comments-measurement.integration.spec.ts): measures one image and ten comments on the real model, Redis and PostgreSQL; it runs only under `RUN_COMMENT_RESOURCE_MEASUREMENT=true` through `npm run community:screening:measure:comments`.

Web component tests:

- [`apps/web/src/app/components/community-comments.test.tsx`](../../apps/web/src/app/components/community-comments.test.tsx): proves compose, reply, private status, delete, report, paging, focus after each control unmounts, contextual names, and one announcement per error.
- [`apps/web/src/app/components/accessible-modal.test.tsx`](../../apps/web/src/app/components/accessible-modal.test.tsx): proves the portal makes the background inert and hidden while open and restores prior values on close (O-LW4).
- [`apps/web/src/app/components/community-lookbook-grid.request-ownership.test.tsx`](../../apps/web/src/app/components/community-lookbook-grid.request-ownership.test.tsx): proves the Story 6.3 ownership cases still hold with two close controls in the dialog.

Mobile component tests:

- [`apps/mobile/components/community/community-comments-sheet.test.tsx`](../../apps/mobile/components/community/community-comments-sheet.test.tsx): proves the native sheet, drafts kept across close, report reason reset per target, a newer report form surviving an older acceptance, focus handles and one announcement.
- [`apps/mobile/src/screens/community-screen.test.tsx`](../../apps/mobile/src/screens/community-screen.test.tsx): proves screen-level ownership through `apps/mobile/src/test-utils/community-screen/feed.cases.tsx`: focus returns to the live Comments control, an unrelated 404 keeps the sheet open, and token storage failure keeps the last identity (O-LM2, O-LM3, P2, T5).

Pact contract tests:

- [`pact/http/consumer/mobile-api-client.pacttest.ts`](../../pact/http/consumer/mobile-api-client.pacttest.ts) and [`pact/http/consumer/web-api-client.pacttest.ts`](../../pact/http/consumer/web-api-client.pacttest.ts): run the comment interactions in `pact/http/consumer/interactions/community/comments.ts`, including refusals, `Retry-After`, exact 404 and scoped pagination (B10, O-M9b).
- [`pact/http/provider/api-provider.pacttest.ts`](../../pact/http/provider/api-provider.pacttest.ts): replays both consumer pacts against real controllers with `pact/http/provider/doubles/community-comments.ts`.

Playwright end-to-end tests:

- [`playwright/tests/community-comments.spec.ts`](../../playwright/tests/community-comments.spec.ts): nine journeys through `scripts/start-api-e2e-with-workers.mjs`: draft across reopen then worker publication, reply under a root that becomes a tombstone, dark scheme and phone width, each withheld sample pinned to its disposition, held status and recovery copy, a lost create response retried with the same mutation id, a report after a failed attempt with focus returned, a teen comment replaced once consent is revoked, and no card-open event when Comments opens the dialog (CR9).
- [`playwright/tests/community-reactions.spec.ts`](../../playwright/tests/community-reactions.spec.ts): the Story 6.3 journey now scopes its close query to the dialog header and asserts dismissal (P8).

Mobile end-to-end test:

- [`maestro/community-comments.yaml`](../../maestro/community-comments.yaml): composes a 273-unit root and a reply with the software keyboard open, reopens the draft, waits for private screening, and reads the published thread.

Harness tests:

- [`playwright/support/helpers/install-expo-go.spec.ts`](../../playwright/support/helpers/install-expo-go.spec.ts): proves the installer writes only the final HTTP 200 body, reuses its cache, removes partial files and bounds redirects (P7).
- [`playwright/support/helpers/run-maestro-bootstrap.spec.ts`](../../playwright/support/helpers/run-maestro-bootstrap.spec.ts): proves the runner builds shared outputs before importing `@couture/testing` on a cold or stale tree (CR10).

Evidence boundaries:

- **Source-comment follow-up.**
  32 of the 32 linked source files in this test map lack a Step 42 cross-link comment in the reviewed Git snapshot.
  This document-only review leaves those source comments for a repository change.

- **Measured for this step.**
  PR #154 merged as `aa8cd0e1` on 2026-10-19 with all 30 checks green on head `0a12b3a5`, read from GitHub.
  `playwright/tests/community-comments.spec.ts` declares nine tests at `aa8cd0e1`, counted here.
  Every path above exists on `main`.
- **Reported by the story and not reproduced here.**
  The final validate totals, the 85 passing comment integration cases, 123 mobile and 132 web Pact interactions, browser 8 of 8 before CR9 added the ninth, iOS and Android Maestro 1 of 1, the 100/100 test review and the 98.2% changed-line coverage (961 of 979 lines) come from the spec and the automation summary.
  Their logs were written to `/tmp` and are not in the repository.
- **iOS device evidence is local.**
  PR CI ran seven Android Maestro shards; the iOS pass was on a local iPhone 17 simulator with iOS 26.1.
- **The resource sample is a developer-machine number.**
  One image took 75 ms and comments took 8 to 15 ms to process, with 56-byte Redis payloads, at a process peak of 702.83 MiB that includes Vitest and the model.
  It does not certify the 512 MiB hosted container envelope.
- **The screening readiness signature predates this code.**
  Comment changes invalidated the screening input-set hash, and the old signature does not cover them.
- **Held and blocked comments have no publication path.**
  Moderator decisions belong to Stories 6.10 and 6.11, both `backlog`.
- **Three accepted costs were turned down in triage, with reasons.**
  A `consent_suspended` status also covers a hidden post or a deleted root (O-LB1), technical-failure intake reuses reason `inappropriate_content` with `screening_failed` in the audit row (O-LB2), and a receipt keeps its SHA-256 after author deletion, readable to a database reader (O-LB3).
- **No account-erasure UI exists**, so the client's erasure listener has no producer (O-LW3).
- **Later stories edited these files.**
  `4be0be64` (Story 6.5), `f7045a7b` (#160), `1d7b9848` (#161) and `67806196` (#162) touched the comment repository, processor, state module or surfaces; #160 added `apps/mobile/src/features/community/community-comment-drafts.ts` and `apps/api/integration/mobile-e2e-community-long-root.integration.spec.ts`.
  This step describes the code at `aa8cd0e1`.

Architecture diagram:

```mermaid
flowchart TD
  subgraph Clients["Web dialog and native sheet"]
    STATE["community-comments-state.ts\ntickets: session generation + post fence\nimmutable retry UUID + body"]
  end

  STATE -- "POST comments\nmutationId" --> CREATE["withThread, exclusive\nmember advisory lock, post FOR UPDATE\nflags resolved first"]
  CREATE --> RECEIPT{"receipt for\nuser + mutationId?"}
  RECEIPT -- "same payload hash" --> REPLAY["return stored submission\nno quota, no side effects"]
  RECEIPT -- "changed payload" --> CONFLICT["409"]
  RECEIPT -- "none" --> ROW["pending_screening row\n+ receipt + screening outbox\n60/min, 200/day"]

  ROW --> DISPATCH["outbox dispatch\nfirst attempt now, then 30 s backoff"]
  DISPATCH --> JOB["BullMQ job\ncomment__id__generation\nids only, no text"]
  JOB --> WORKER["standalone worker\nCommunityTextScreener, field caption"]
  WORKER --> ROLLOUT{"per-author flags\nbefore and after screening"}
  ROLLOUT -- "frozen" --> DEFER["bump generation\nstays private"]
  ROLLOUT -- "open" --> LOCKED["locked recheck\npost visible, consent, root published"]
  LOCKED -- "ineligible" --> SUSP["consent_suspended\nbody cleared"]
  LOCKED -- "review or block" --> HELD["held_for_review or blocked\n+ intake + audit"]
  LOCKED -- "pass" --> PUB["published\nsequence = post counter + 1"]
  WORKER -- "3 attempts or 15 min stale" --> FAIL["screening_failed\n+ intake + audit"]

  PUB --> PAGE["GET comments and replies\nshared locks, snapshot watermark cursor\npage 20, max 50"]
  PAGE --> STATE
  HELD --> PRIV["GET comment-submissions\nauthor only"]
  FAIL --> PRIV
  PRIV --> STATE

  STATE -- "POST report" --> REPORT["member + community_report locks\nshared 50 per 24 h quota"]
  REPORT --> INTAKE["CommunityCommentReport\nrouted_at within 5 min (check)\nsla_due_at = accepted_at + 24 h"]

  REVOKE["guardian revocation"] --> SUSP
  ERASE["account erasure"] --> SCRUB["erased: body, user, receipts,\nsnapshots, outbox, analytics subject"]
```

## Step 43: Realtime engagement and push notifications

User/business impact:

Before this step a member saw a new look, reaction or comment only after a manual refresh.
Now an open feed or thread converges on its own.
A healthy WebSocket rings a doorbell within seconds, and a bounded polling fallback catches up within 20 seconds when the socket is down.
Members who opt in also get a push notification when someone reacts to their look, comments on it, or replies to their comment.
Tapping that notification opens the exact post, comment or reply, even when it sits off page one, from a warm, backgrounded or killed app.
Opt-in is off by default and needs OS permission, a registered device token, the global push switch and the account's quiet hours to agree.
Erasure, consent loss, opt-out and token transfer fence every late send and every stale fetch.
Production stays dark: `community_read_enabled` and `community_write_enabled` remain false, and `COMMUNITY_DISPATCH_ENABLED` must be set to `true` before any push leaves the server.

Key takeaways:

1. **The WebSocket runs in its own Vercel function.**
   `apps/api/api/realtime.ts` exports a Node HTTP server with Socket.IO on Fluid Compute.
   `apps/api/vercel.json` gives it `maxDuration: 300` and leaves the REST function at 25 seconds.
   An explicit `/api/realtime` rewrite sits before the catch-all.
   The server recycles each connection at 295 seconds and the client reconnects with a fresh token.
2. **The socket is a doorbell and carries no data.**
   The only domain message is `{ version: 1, type: 'community:changed' }`, at most one per socket per second.
   Clients then fetch through the same authorized HTTP endpoints every other read uses.
   No stream sequence, actor, target or content crosses the socket.
3. **Cross-instance delivery comes from a one-second database head check.**
   Each realtime instance compares the public head and each connected member's private head with what it last rang for.
   That reaches sockets pinned to any instance with no Redis Pub/Sub and no shared instance memory.
4. **Domain writes never touch the stream head.**
   Producers insert a minimal outbox row in their own transaction, under the post lock they already hold.
   A separate bounded appender turns committed outbox rows into stream events.
   It skips busy candidates with savepoints and `FOR UPDATE SKIP LOCKED`, takes stream-head locks with `NOWAIT`, and commits counter and events together.
   A later committed sequence therefore cannot hide an earlier one, so a cursor never skips.
   Clients still apply state only through per-post revisions, because append order and commit order can differ.
5. **Polling is the outage path.**
   A client with a healthy socket runs no periodic REST catch-up.
   Bootstrap, connect, foreground and each doorbell trigger one shared single-flight catch-up.
   Fallback polling runs only while the socket is down, every 5 to 5.5 seconds in `packages/api-client/src/community-sync-state.ts`, inside the design's eight-second bound.
6. **Unavailable and denied are different answers.**
   A completed remote `false` is a 403 or a `denied` control.
   A dependency that cannot answer in time is a typed 503 or an `unavailable` control.
   The client hides content on either, keeps permitted drafts on `unavailable`, and treats an ordinary disconnect as `recovering`.
7. **One per-member flag cache serves every process.**
   `CommunityFlagEvaluation` holds the remote rollout answer for 60 seconds, refreshes ahead at 45 seconds, and lets one claimant call the remote per claim window.
   Validity is anchored to the database claim time, so client clocks and provider latency cannot stretch a grant.
   Every read, socket and send path uses it, and an expired grant serves nothing.
8. **Provider acceptance is the dispatch boundary.**
   The sender commits a `sending` attempt before the HTTP call, makes exactly one request with a two-second deadline, and records `unknown` for any ambiguous outcome.
   `unknown` never authorizes another send.
   Only an explicit rejection retries, at most three attempts.
9. **Privacy serializes against send start with dedicated advisory locks.**
   `community_privacy:<memberId>` and `community_post_privacy:<postId>` use PostgreSQL's two-integer lock API, apart from the existing engagement locks.
   The send transaction holds shared guards through the provider call, with `transaction_timeout = '3s'`, so erasure waits at most that long.
   Dispatch refuses to start on a server below PostgreSQL 17, because `transaction_timeout` arrived in PostgreSQL 17.
10. **A notification identity qualifies once.**
    The first reaction by an actor on a post, the first publication of a comment, and the first publication of a reply each record a tombstone even when delivery is suppressed.
    Remove and re-add, replay, rescreen and re-opt-in cannot send it again.
    Replies notify the union of post author and parent author, minus the actor.
11. **Quiet hours are evaluated on real instants.**
    The evaluator walks UTC minutes through the stored IANA zone, so a skipped spring-forward minute cannot schedule work and a repeated fall-back minute stays quiet.
    Intents expire 24 hours after qualification, later groups for one recipient and post wait 30 seconds, and the quiet-hour exit herd is due immediately.
12. **Token cleanup is scoped to a binding generation, weather included.**
    A `DeviceNotRegistered` ticket or receipt removes only the matching registration and generation.
    The weather alert path now carries the same registration ID, owner and generation, so a late weather receipt for an old owner cannot delete the token after it moves to a new account.

Hard-won lessons from the implementation and code review of this story:

1. **The "Vercel cannot do WebSockets" finding was wrong.**
   A story reviewer called the platform incapable.
   [Vercel's WebSocket announcement](https://vercel.com/changelog/websocket-support-is-now-in-public-beta) documents support on Fluid compute.
   The spec's review log records that finding as withdrawn after official support verification, and D1 links the Vercel WebSocket guide.
   Check the platform's current docs before designing around an absent capability.
2. **A transaction-ID ordering recipe looked right and was rejected.**
   A reviewer proposed `bigserial` plus an `xmin` horizon for commit-safe cursors.
   Transaction IDs and sequence values can be allocated in different orders, so a returned later sequence can sit in front of an invisible earlier one.
   The committed-outbox appender keeps the hot head lock out of source transactions and recovers without the screening worker.
3. **Five independent reviewers found the same opt-in bug.**
   An enabled-only PATCH left the account's quiet-hours policy row absent, and every downstream path then suppressed the member who had just opted in.
   The first code review batch held 67 findings: 25 high, 38 medium, 2 low, and 2 rejected.
   B1, E5, V3, ASTRA-C07 and OPUS-H3 were this one defect.
4. **Revalidation in lockstep took down healthy sockets.**
   The realtime load lane connected 100 sockets per instance at once.
   With a fixed four-second cadence and unbounded concurrency, about one run in three sent `unavailable` to 17 to 144 healthy sockets inside the declared envelope.
   The fix spread revalidation to 4 to 6 seconds per socket and bounded concurrent authorizations per instance.
   The lane recorded three slots; live code now uses five, because three left two pool connections idle while cold flag transactions used up queued handshakes' budgets.
5. **React Native's WebSocket sends an Origin.**
   Native clients were supposed to omit Origin and present a bearer.
   React Native builds a default Origin from the socket URL, so the server refused every native handshake.
   The server now treats an Origin naming its own host like an absent one, bearer only.
   The same commit, `1455df73`, raised `maxHttpBufferSize` to 16 KB, because real Supabase bearers exceed 1 KB once user and app metadata are in them and the engine dropped them before identity was checked.
6. **React Native lacks `AbortSignal.timeout`, `AbortSignal.any` and `DOMException`.**
   Node has all three, so the unit suites could not see the gap.
   `packages/api-client/src/request-deadline.ts` replaced them, and the mobile and api-client test setups now delete `DOMException` so Node cannot mask it again.
   Removing the leaked `AbortSignal.timeout(5000)` then exposed a latent test defect: `interceptNetworkCall` awaits `response.json()` on a 409 the app never reads, and Chromium never finishes an unread body.
7. **Hiding content on every disconnect broke the app, and showing it on every disconnect broke privacy.**
   D3 first hid content on any transport loss.
   That aborted in-flight publish, report and photo work on foreground and on the 295-second recycle (OPUS-H6).
   `1d529468` then kept feeds visible on any reconnect, which round 8 flagged as showing content whose access nobody had verified.
   The rule that shipped lives in `packages/api-client/src/community-verification.ts`: content stays during `recovering` only within 8 seconds of the last successful authorization, and a foreground restore stays hidden until a catch-up verifies.
8. **A cache fix for one path left the sibling path leaking.**
   Round 8's M6 keyed the Home ritual cache by application user, so Home stopped reading member A's cached ritual for member B.
   Round 9 found the background-fetch task computing its cache owner before session restore, so a cold background wake saved member A's location and outfit under the shared `signed-out` key.
   `50f29955` resolves the session first and skips both fetch and save without one.
9. **An adaptive batch limit only shrank.**
   Every append exception halved `readyLimit`, including ordinary `NOWAIT` contention, and no success path restored it.
   Four aborts took the batch from 25 to 1 for the life of the process (OPUS-RR2-N3).
   The stream integration tests later gave each test its own appender, because the adaptive limit leaked between tests.
10. **Identity outages read as logouts.**
    Real identity network failures, 503, 429 and malformed JSON became `Unauthorized`, and downstream code treated that as denial (OPUS-RR2-N2, ASTRA-RR2-01).
    Infrastructure provenance now survives the identity, profile and community boundaries as a typed 503.
    The PR #157 web review added the opposite case: an erased subject is a terminal typed 403 before any flag-cache read.
11. **The convenient offline-logout fix kept a credential the design forbids.**
    `ab1f7692` retried server cleanup after an offline logout by keeping that member's access token.
    D5 says no credential outlives logout, and round 8's M1 removed it.
    Offline logout now keeps only the opaque pending registration ID, so the server binding stays live until the owner signs in again, the installation transfers, or 30 days pass.
12. **Large sessions need chunked secure storage.**
    Expo SecureStore warns above 2048 bytes, and iOS Keychain can refuse larger values.
    The observed Supabase session exceeded that guidance, so the adapter uses an 1800-byte per-value budget.
    `apps/mobile/src/lib/secure-session-storage.ts` stores it in chunks with a manifest as the commit point and sweeps orphaned chunk generations.
13. **Metro could not resolve the `.js` specifiers NodeNext requires for dynamic imports.**
    The Expo dev server never became healthy in Maestro CI until `6c3907f9` taught `apps/mobile/metro.config.js` to resolve them.
14. **A held provider shows the price of terminal uncertainty.**
    In the herd lane a provider held for 25 seconds and aborted at 2 seconds left 241 deliveries accepted and 259 `unknown`, with zero duplicates.
    Those 259 are lost pushes by design.
    D7 chose that over any chance of a second send after an ambiguous handoff.
15. **Reviewer claims were rejected only with evidence.**
    OPUS-L14 claimed retention never deleted rows with a null `completed_at`; an SQL probe showed `NOT(completed_at < cutoff)` handles null as intended.
    Review rounds 2 and 3 rejected five more claims.
    Each rejection row in the spec names the source trace or probe that disproved it.

Story/Task mapping:

- D1, deployed topology and transport: `apps/api/api/realtime.ts`, `apps/api/vercel.json`, `apps/api/src/realtime/community-realtime.server.ts`, `apps/api/src/realtime/community-realtime-instance.ts`, `apps/api/src/main.ts`, `packages/api-client/src/realtime/community-transport.ts`.
- D2, committed outboxes and serialized append: `packages/db/prisma/migrations/20261020120000_community_realtime/migration.sql`, `apps/api/src/modules/community/community-stream.repository.ts`.
- D3, events, catch-up, snapshots and revocation: `community-sync.controller.ts`, `community-sync.service.ts`, `community-targets.service.ts`, `community-cursor.ts`, `community-access.service.ts`, `community-availability.ts`, `packages/api-client/src/community-sync-state.ts`, `packages/api-client/src/community-verification.ts`.
- D4, shared preferences: `community-preferences.service.ts`, `packages/api-client/src/community-notification-settings.ts`, both notification-settings screens.
- D5, authentication, installation binding and notification-open lifecycle: `apps/web/src/lib/web-session.ts`, `apps/mobile/src/lib/native-session.ts`, `apps/mobile/src/lib/secure-session-storage.ts`, `apps/mobile/src/lib/native-notifications.ts`, `push-registration.controller.ts`, `push-registration.service.ts`, `packages/api-client/src/community-notification-responses.ts`, `packages/utils/src/deep-link.ts`.
- D6, qualification, recipients, quiet hours and coalescing: `community-engagement-intent.ts`, `community-push-policy.ts`, `community-notifications.worker.ts`.
- D7, durable attempts, privacy serialization and uncertainty: `community-send-guard.ts`, `community-push-provider.ts`, `community-receipts.worker.ts`, `community-privacy.ts`, the shared weather fanout chain.
- D8, erasure, retention and telemetry: `community-retention.worker.ts`, `community-operational-telemetry.ts`, `packages/db/prisma/migrations/20261021120000_community_privacy_guard_trigger_permissions/migration.sql`.
- D9, client presentation and target focus: `apps/web/src/app/components/community-lookbook-grid.tsx`, `apps/mobile/src/features/community/community-screen.tsx`, `apps/mobile/app/notification-settings.tsx`, `apps/web/src/app/notification-settings/page.tsx`.
- D10, operating envelope and proof: the four `*.acceptance.spec.ts` lanes, `scripts/probe-community-preview.mjs`, `scripts/run-story65-native.mjs`, `maestro/story65/`.
- The spec's execution checklist keeps every box unchecked even though the story is `done`; the review triage tables and the D10 lanes are the completion record.

Story reference:

- `_bmad-output/implementation-artifacts/spec-6-5-realtime-engagement-notifications.md`, whose review triage tables record every code review finding through round 4 with its verdict and repair group.
- `_bmad-output/implementation-artifacts/6-5-realtime-engagement-design.md`, the normative D1 to D10 design with its numeric limits.
- `_bmad-output/implementation-artifacts/reviews/story-6-5-opus-code-review.md`, `story-6-5-astra-code-tea-review.md` and `story-6-5-code-triage.md` for the first code review batch.
- `_bmad-output/project-knowledge/deployment-guide.md`, section `Story 6.5 engagement dispatch controls`, for `COMMUNITY_DISPATCH_ENABLED`, `COMMUNITY_ENGAGEMENT_OWNER` and the dispatch readiness states.

Cross-links:

- Step 6 for the original live-update and polling design; this step keeps `lookbook:new`, `/api/v1/events/poll` and the legacy `EventEnvelope` unchanged and adds separate community streams.
- Step 17 for the weather alert fanout and push-token storage this step makes generation-scoped.
- Step 27 for the deep-link contract that now accepts `commentId` and `parentId` on community notifications.
- Step 38 for the community feed, outbox, RLS posture and rollout flags this step builds on.
- Step 42 for threaded comments: their publication, removal and author-private screening status are the events this step streams, and the comment drafts and focus rules this step must preserve.

Sequence to follow:

1. `apps/api/vercel.json` and `apps/api/api/realtime.ts`: two functions, two duration budgets, and the rewrite order that keeps `/api/realtime` out of the REST catch-all.
2. `apps/api/src/realtime/community-realtime.server.ts`: handshake checks, the one-second tick, jittered revalidation, the doorbell and the two control statuses.
3. `packages/db/prisma/migrations/20261020120000_community_realtime/migration.sql`: outboxes, heads, events, subjects, intents, groups, deliveries, attempts and the capability row.
4. `apps/api/src/modules/community/community-stream.repository.ts`: the bounded appender and snapshot-bounded replay.
5. `apps/api/src/modules/community/community-sync.service.ts` and `community-targets.service.ts`: captured heads before views, two-lane scans, and off-page target resolution.
6. `apps/api/src/modules/feature-flags/community-flag-evaluation.service.ts`: the shared claim, refresh-ahead and hard expiry.
7. `packages/api-client/src/community-sync-state.ts`, `community-verification.ts` and `realtime/community-transport.ts`: the client half of catch-up, visibility and reconnect.
8. `apps/api/src/modules/community/community-engagement-intent.ts`, `community-push-policy.ts` and `community-notifications.worker.ts`: who qualifies, when, and how groups form.
9. `apps/api/src/modules/community/community-send-guard.ts`, `community-push-provider.ts` and `community-receipts.worker.ts`: the guarded handoff and what happens after it.
10. `apps/mobile/src/lib/native-session.ts` and `native-notifications.ts`: sign-in, restore, registration and the OS response lifecycle.
11. `apps/api/src/modules/community/community-engagement.runtime.ts` and the deployment guide section: which loops run, and why dispatch stays frozen.

Task owner map:

Each production file below carries a `Story 6.5` header comment near its top that names its job.
The story carries no numbered `Story 6.5 Task N step M owner` anchors.

- Realtime transport owner: `apps/api/api/realtime.ts` for the dedicated function entry, `apps/api/src/realtime/community-realtime.server.ts` for handshake, revalidation and doorbells.
- Client transport owner: `packages/api-client/src/realtime/community-transport.ts` for websocket-only connect, fresh tokens and the 500 ms to 15 s reconnect backoff.
- Stream owner: `apps/api/src/modules/community/community-stream.repository.ts` for append, assist and replay.
- Sync and target owner: `apps/api/src/modules/community/community-sync.controller.ts` for the routes, `community-sync.service.ts` for event pages, `community-targets.service.ts` for target resolution, `community-cursor.ts` for signed cursors.
- Access owner: `apps/api/src/modules/community/community-access.service.ts` for fresh eligibility, `apps/api/src/modules/feature-flags/community-flag-evaluation.service.ts` for the shared rollout cache.
- Client reconciliation owner: `packages/api-client/src/community-sync-state.ts` for single-flight catch-up and revision fences, `packages/api-client/src/community-verification.ts` for the 8-second visibility rule.
- Preferences owner: `apps/api/src/modules/community/community-preferences.service.ts` for revision-guarded opt-in and shared quiet hours.
- Qualification and policy owner: `apps/api/src/modules/community/community-engagement-intent.ts` for first-occurrence intents, `community-push-policy.ts` for quiet hours and outcome policy.
- Dispatch owner: `apps/api/src/modules/community/community-notifications.worker.ts` for grouping and fanout, `community-send-guard.ts` for the guarded handoff, `community-push-provider.ts` for the single HTTP call, `community-receipts.worker.ts` for receipts and pruning.
- Privacy and retention owner: `apps/api/src/modules/community/community-privacy.ts` for lock order, `community-retention.worker.ts` for bounded deletion, `community-operational-telemetry.ts` for content-free outcomes.
- Runtime owner: `apps/api/src/modules/community/community-engagement.runtime.ts` for the independent loops and the frozen dispatch preflight.
- Registration owner: `apps/api/src/modules/notifications/push-registration.controller.ts` and `push-registration.service.ts` for owner-scoped bindings, five per account, and transfers.
- Web session owner: `apps/web/src/lib/web-session.ts` for the verified OTP session bridge.
- Native session owner: `apps/mobile/src/lib/native-session.ts` for restore, refresh and canonical identity, `apps/mobile/src/lib/secure-session-storage.ts` for chunked persistence.
- Native notification owner: `apps/mobile/src/lib/native-notifications.ts` for permission, Expo token binding and OS responses, `packages/api-client/src/community-notification-responses.ts` for response dedupe and routing readiness.
- Native acceptance owner: `scripts/run-story65-native.mjs` for the isolated `com.couturecast.story65` build runner, `scripts/probe-community-preview.mjs` for the hosted preview probe.

Tests that cover this step:

The files below are the direct coverage.
Execution evidence for the gated lanes lives under `_bmad-output/test-artifacts/story-6-5/`, which `.gitignore` keeps out of the repository.

API unit tests:

- [`apps/api/src/modules/community/community-push-policy.spec.ts`](../../apps/api/src/modules/community/community-push-policy.spec.ts): quiet-hour instants across DST, invalid policy, expiry, and localized anonymous copy.
- [`apps/api/src/modules/community/community-push-provider.spec.ts`](../../apps/api/src/modules/community/community-push-provider.spec.ts): exactly one invocation per attempt and no call after cancellation.
- [`apps/api/src/modules/community/community-engagement.runtime.spec.ts`](../../apps/api/src/modules/community/community-engagement.runtime.spec.ts): independent loops, dispatch readiness states, and a negative control with one loop omitted.
- [`apps/api/src/modules/community/community-availability.spec.ts`](../../apps/api/src/modules/community/community-availability.spec.ts): one authorization budget carried to final use, and dependency failure kept apart from denial.
- [`apps/api/src/modules/community/community-cursor.spec.ts`](../../apps/api/src/modules/community/community-cursor.spec.ts): tampered, scope-mismatched and stale cursors are refused.
- [`apps/api/src/modules/community/community-privacy.spec.ts`](../../apps/api/src/modules/community/community-privacy.spec.ts): deadlock and lock-timeout recovery for privacy transactions.
- [`apps/api/src/modules/community/community-retention.worker.spec.ts`](../../apps/api/src/modules/community/community-retention.worker.spec.ts): retention batches respect privacy fences.
- [`apps/api/src/modules/community/community-operational-telemetry.spec.ts`](../../apps/api/src/modules/community/community-operational-telemetry.spec.ts): durable, deduplicated, content-free telemetry delivery.
- [`apps/api/src/realtime/community-realtime-instance.spec.ts`](../../apps/api/src/realtime/community-realtime-instance.spec.ts): each realtime process carries one opaque instance value for hosted proofs.

Real-PostgreSQL integration tests, run by `test:coverage` in CI:

- [`apps/api/integration/community-stream.integration.spec.ts`](../../apps/api/integration/community-stream.integration.spec.ts): commit-safe append, skipped busy candidates, and replay bounded by captured heads.
- [`apps/api/integration/community-stream-lock-release.integration.spec.ts`](../../apps/api/integration/community-stream-lock-release.integration.spec.ts): the production savepoint rollback releases a candidate's advisory locks, with a mutant that must fail.
- [`apps/api/integration/community-sync-http.integration.spec.ts`](../../apps/api/integration/community-sync-http.integration.spec.ts): real controllers and generated client wrappers for events, targets and preferences.
- [`apps/api/integration/community-realtime.integration.spec.ts`](../../apps/api/integration/community-realtime.integration.spec.ts): the real websocket-only server with fixture auth, the Origin matrix and doorbell payloads.
- [`apps/api/integration/community-realtime-revalidation.integration.spec.ts`](../../apps/api/integration/community-realtime-revalidation.integration.spec.ts): 100 sockets connecting together stay connected on a bounded pool.
- [`apps/api/integration/community-handshake-refusal.integration.spec.ts`](../../apps/api/integration/community-handshake-refusal.integration.spec.ts): a refused handshake falls back to polling and keeps the feed HTTP is serving.
- [`apps/api/integration/community-transport-client.integration.spec.ts`](../../apps/api/integration/community-transport-client.integration.spec.ts): the shared client transport against the real server.
- [`apps/api/integration/community-flag-evaluation.integration.spec.ts`](../../apps/api/integration/community-flag-evaluation.integration.spec.ts): cross-process claims, refresh-ahead, clock skew and hard expiry.
- [`apps/api/integration/community-flag-provider.integration.spec.ts`](../../apps/api/integration/community-flag-provider.integration.spec.ts): the real remote flag adapter against an HTTP recorder.
- [`apps/api/integration/community-qualification.integration.spec.ts`](../../apps/api/integration/community-qualification.integration.spec.ts): an intent qualifies only for a current, opted-in recipient with a valid policy, and stops qualifying at expiry.
- [`apps/api/integration/community-policy-eligibility.integration.spec.ts`](../../apps/api/integration/community-policy-eligibility.integration.spec.ts): real PATCH and PUT keep the scheduling floor and quiet-boundary history.
- [`apps/api/integration/community-delivery.integration.spec.ts`](../../apps/api/integration/community-delivery.integration.spec.ts): the actual guarded provider boundary, grouping and fanout.
- [`apps/api/integration/community-send-outcomes.integration.spec.ts`](../../apps/api/integration/community-send-outcomes.integration.spec.ts): every provider outcome settles the durable delivery exactly once.
- [`apps/api/integration/community-receipt-boundary.integration.spec.ts`](../../apps/api/integration/community-receipt-boundary.integration.spec.ts): a pending receipt near 24 hours clamps to expiry with no resend.
- [`apps/api/integration/community-engagement-process-loss.integration.spec.ts`](../../apps/api/integration/community-engagement-process-loss.integration.spec.ts): process death during send leaves the attempt `unknown`, and recovery starts no second one.
- [`apps/api/integration/community-engagement-db-fault.integration.spec.ts`](../../apps/api/integration/community-engagement-db-fault.integration.spec.ts): the server-side guard lifetime under process and network faults.
- [`apps/api/integration/community-privacy-matrix.integration.spec.ts`](../../apps/api/integration/community-privacy-matrix.integration.spec.ts): every cross-feature privacy entry point and subject role.
- [`apps/api/integration/community-privacy-producers.integration.spec.ts`](../../apps/api/integration/community-privacy-producers.integration.spec.ts): erasure and consent producers emit anonymous resyncs and recreate no linkage.
- [`apps/api/integration/community-erased-subject-denial.integration.spec.ts`](../../apps/api/integration/community-erased-subject-denial.integration.spec.ts): an erased subject gets the terminal typed 403 on every shared path, including the realtime server.
- [`apps/api/integration/community-weather-transfer.integration.spec.ts`](../../apps/api/integration/community-weather-transfer.integration.spec.ts): a held weather send cannot prune a token that moved to a new owner.
- [`apps/api/integration/push-registration.integration.spec.ts`](../../apps/api/integration/push-registration.integration.spec.ts): binding ownership, the five-registration limit and refused blind transfers.
- [`apps/api/integration/auth-signup-email-case.integration.spec.ts`](../../apps/api/integration/auth-signup-email-case.integration.spec.ts): one application account per email, whatever its case.

Database tests:

- [`packages/db/test/community-privacy-trigger-upgrade.spec.ts`](../../packages/db/test/community-privacy-trigger-upgrade.spec.ts): the second migration replaces the guard functions in place and the triggers keep firing them.

Gated acceptance lanes, excluded unless `RUN_STORY65_ACCEPTANCE=true` and absent from every CI workflow:

- [`apps/api/integration/community-flag-cache-timeline.acceptance.spec.ts`](../../apps/api/integration/community-flag-cache-timeline.acceptance.spec.ts): lane A, the real wall-clock 45/60 cache timeline across two compiled evaluator processes.
- [`apps/api/integration/community-retention-cutoffs.acceptance.spec.ts`](../../apps/api/integration/community-retention-cutoffs.acceptance.spec.ts): lane B, each retention cutoff seeded one minute either side.
- [`apps/api/integration/community-push-herd.acceptance.spec.ts`](../../apps/api/integration/community-push-herd.acceptance.spec.ts): lane C, a 500-token quiet-hour exit herd plus burst and sustained traffic, worker stall and provider hold.
- [`apps/api/integration/community-realtime-load.acceptance.spec.ts`](../../apps/api/integration/community-realtime-load.acceptance.spec.ts): lane D, 100 sockets per instance, 20 reactions per second, and instance failover.

Shared client tests:

- [`packages/api-client/testing/community-sync-state.spec.ts`](../../packages/api-client/testing/community-sync-state.spec.ts): single-flight catch-up, revision fences and request ownership.
- [`packages/api-client/testing/community-verification.spec.ts`](../../packages/api-client/testing/community-verification.spec.ts): the 8-second verification clock and foreground hiding.
- [`packages/api-client/testing/community-transport.spec.ts`](../../packages/api-client/testing/community-transport.spec.ts): the production transport's retry, token lookup, control parsing and teardown.
- [`packages/api-client/testing/community-transport-retirement.spec.ts`](../../packages/api-client/testing/community-transport-retirement.spec.ts): callbacks from a retired socket change nothing.
- [`packages/api-client/testing/community-notification-responses.spec.ts`](../../packages/api-client/testing/community-notification-responses.spec.ts): OS response dedupe and buffering behind auth and router readiness.
- [`packages/api-client/testing/community-settings-client.spec.ts`](../../packages/api-client/testing/community-settings-client.spec.ts): sparse preference edits, 409 recovery and target correlation.
- [`packages/api-client/testing/community-sync-client-error-body.spec.ts`](../../packages/api-client/testing/community-sync-client-error-body.spec.ts): handled error bodies are drained.
- [`packages/api-client/testing/community-comments-recovery.spec.ts`](../../packages/api-client/testing/community-comments-recovery.spec.ts): comment recovery cancellation and focused page ownership.
- [`packages/api-client/testing/request-deadline.spec.ts`](../../packages/api-client/testing/request-deadline.spec.ts): the portable request deadline that replaced `AbortSignal.timeout`.
- [`packages/utils/src/deep-link.coverage.spec.ts`](../../packages/utils/src/deep-link.coverage.spec.ts): `commentId` and `parentId` are valid only with a community `cardId`.

Web unit and component tests:

- [`apps/web/src/app/components/community-lookbook-grid.recovering.test.tsx`](../../apps/web/src/app/components/community-lookbook-grid.recovering.test.tsx): fresh versus stale verification on reconnect, and the outage notice.
- [`apps/web/src/app/components/community-lookbook-grid.new-looks-scope.test.tsx`](../../apps/web/src/app/components/community-lookbook-grid.new-looks-scope.test.tsx): a filter change drops buffered new looks and retires an insertion already under way.
- [`apps/web/src/app/components/community-lookbook-grid.notification-deadline.test.tsx`](../../apps/web/src/app/components/community-lookbook-grid.notification-deadline.test.tsx): the first target attempt always dispatches and no retry starts past the 10-second bound.
- [`apps/web/src/app/components/community-lookbook-grid.resync-focus.test.tsx`](../../apps/web/src/app/components/community-lookbook-grid.resync-focus.test.tsx): focus and suspended modals survive a resync.
- [`apps/web/src/app/components/community-lookbook-grid.request-ownership.test.tsx`](../../apps/web/src/app/components/community-lookbook-grid.request-ownership.test.tsx): late responses under an older generation are discarded.
- [`apps/web/src/app/components/community-lookbook-grid.coverage.test.tsx`](../../apps/web/src/app/components/community-lookbook-grid.coverage.test.tsx): community scope erasure on identity loss.
- [`apps/web/src/app/notification-settings/page.test.tsx`](../../apps/web/src/app/notification-settings/page.test.tsx) and [`page.coverage.test.tsx`](../../apps/web/src/app/notification-settings/page.coverage.test.tsx): rendered settings through the real HTTP wrapper, policy failures and ownership.
- [`apps/web/src/app/signin/page.coverage.test.tsx`](../../apps/web/src/app/signin/page.coverage.test.tsx): OTP sign-in tells denial, a wrong code and a temporary failure apart.
- [`apps/web/src/lib/web-session.auth-boundary.test.ts`](../../apps/web/src/lib/web-session.auth-boundary.test.ts) and [`web-session.coverage.test.ts`](../../apps/web/src/lib/web-session.coverage.test.ts): the verified session reaches real authenticated requests, and its failure boundaries.
- [`apps/web/src/app/components/session-bridge.coverage.test.tsx`](../../apps/web/src/app/components/session-bridge.coverage.test.tsx): the session bridge's subscription lifecycle.

Mobile unit and screen tests:

- [`apps/mobile/src/screens/community-screen.test.tsx`](../../apps/mobile/src/screens/community-screen.test.tsx): runs `realtime.cases.tsx` and `notification-recovery.cases.tsx` against the actual screen, coordinator and generated HTTP wrappers.
- [`apps/mobile/src/lib/native-notifications.test.ts`](../../apps/mobile/src/lib/native-notifications.test.ts): permission, binding enablement, OS responses and revocation.
- [`apps/mobile/src/lib/native-notifications-offline-logout.test.ts`](../../apps/mobile/src/lib/native-notifications-offline-logout.test.ts): offline logout keeps only the opaque pending registration.
- [`apps/mobile/src/lib/native-notifications-stale-binding.test.ts`](../../apps/mobile/src/lib/native-notifications-stale-binding.test.ts): the next owner registers past a previous owner's stale binding.
- [`apps/mobile/src/lib/native-logout-durability.test.ts`](../../apps/mobile/src/lib/native-logout-durability.test.ts): logout removes the stored session while registration is stalled on the OS token.
- [`apps/mobile/src/lib/native-session.test.ts`](../../apps/mobile/src/lib/native-session.test.ts) and [`native-session-storage.test.ts`](../../apps/mobile/src/lib/native-session-storage.test.ts): verified session ownership, and chunked storage within the adapter's 1800-byte budget, below SecureStore's 2048-byte guidance.
- [`apps/mobile/src/lib/native-signin-reasons.test.ts`](../../apps/mobile/src/lib/native-signin-reasons.test.ts) and [`apps/mobile/src/screens/signin-screen.test.tsx`](../../apps/mobile/src/screens/signin-screen.test.tsx): native sign-in failure classification and copy.
- [`apps/mobile/src/lib/native-notification-fixture.test.ts`](../../apps/mobile/src/lib/native-notification-fixture.test.ts), [`native-notification-fixture-gating.test.ts`](../../apps/mobile/src/lib/native-notification-fixture-gating.test.ts) and [`native-intent.test.ts`](../../apps/mobile/src/lib/native-intent.test.ts): the debug OS injection exists only in the isolated build, and the router drops its fixture URL.
- [`apps/mobile/src/screens/notification-settings-screen.test.tsx`](../../apps/mobile/src/screens/notification-settings-screen.test.tsx) and [`notification-settings-recovery.test.tsx`](../../apps/mobile/src/screens/notification-settings-recovery.test.tsx): native settings journeys, failures, retry and cleanup.
- [`apps/mobile/src/screens/community-session-recovery.test.tsx`](../../apps/mobile/src/screens/community-session-recovery.test.tsx): concurrent cold verification resolves to the member or to a retryable state.
- [`apps/mobile/src/screens/hero-identity-cache.test.tsx`](../../apps/mobile/src/screens/hero-identity-cache.test.tsx) and [`apps/mobile/src/lib/background-fetch.test.ts`](../../apps/mobile/src/lib/background-fetch.test.ts): after an account switch, Home and background fetch read and store only the current member's ritual.
- [`apps/mobile/src/screens/hero-session-restore.test.tsx`](../../apps/mobile/src/screens/hero-session-restore.test.tsx): Home loads once a cold-start identity is ready.

Pact contract tests:

- [`pact/http/consumer/web-api-client.pacttest.ts`](../../pact/http/consumer/web-api-client.pacttest.ts) and [`mobile-api-client.pacttest.ts`](../../pact/http/consumer/mobile-api-client.pacttest.ts): the engagement interactions in `pact/http/consumer/interactions/community/engagement.ts`.
- [`pact/http/provider/api-provider.pacttest.ts`](../../pact/http/provider/api-provider.pacttest.ts): replays them against real controllers with the `community-engagement` provider double.

Playwright end-to-end tests:

- [`playwright/tests/community-engagement.spec.ts`](../../playwright/tests/community-engagement.spec.ts): E2E-001 to E2E-005 in two browsers, covering healthy socket delivery with no fallback polling, outage fallback within eight seconds and epoch resync, author-private status, off-page reply focus, and a late prior-account target result.
- [`playwright/tests/community-real-session.spec.ts`](../../playwright/tests/community-real-session.spec.ts) and [`community-real-session-identity.spec.ts`](../../playwright/tests/community-real-session-identity.spec.ts): real OTP sign-in, canonical identity, restore, refresh, account switch and offline logout; they skip without the owned harness.
- [`playwright/tests/community-engagement-preview.spec.ts`](../../playwright/tests/community-engagement-preview.spec.ts): the hosted probe for the 101 upgrade, Origin matrix, identifier-free doorbells and the 295-second recycle; it runs only from `pw-e2e-trigger` with scope `o1-realtime-probe`.
- [`playwright/support/helpers/probe-community-preview.spec.ts`](../../playwright/support/helpers/probe-community-preview.spec.ts): the probe aborts with zero writes unless the target reports a preview environment.

Mobile end-to-end tests:

- [`maestro/story65/community-notification-tap.yaml`](../../maestro/story65/community-notification-tap.yaml), [`notification-permission.yaml`](../../maestro/story65/notification-permission.yaml), [`session-restore.yaml`](../../maestro/story65/session-restore.yaml) and [`session-logout.yaml`](../../maestro/story65/session-logout.yaml): real OS notification taps, permission dialogs and session lifecycle, driven by `scripts/run-story65-native.mjs` against the isolated build.
  No CI workflow runs them.
- [`maestro/community-comments.yaml`](../../maestro/community-comments.yaml): now waits for a live-inserted comment, and runs in the Android CI shards.

Evidence boundaries:

- **Source-comment follow-up.**
  89 of the 89 linked source files in this test map lack a Step 43 cross-link comment in the reviewed Git snapshot.
  This document-only review leaves those source comments for a repository change.

- **Local review artifacts.**
  The cited `story-*` review records are retained locally under `_bmad-output/test-artifacts/` and ignored by Git.
  A fresh checkout can use the tracked story spec as the portable account of those findings.

- **What I reproduced.**
  The merge is `4be0be64` (PR #157, squashed from 30 commits), 396 files and 51,350 insertions by `git show --stat`.
  Every path in this step exists on `main`.
  PR #157's final check rollup on GitHub reads green for `quality-gate`, `Local schema and Pact contracts`, both `pw-e2e` shards, seven `mobile-e2e-android` shards, `burn-in` and `k6-smoke`.
  I read those statuses; I ran no suite.
  The first code review batch count (67 findings) is my count of the spec's triage table.
- **What I only read in artifacts.**
  The acceptance-lane numbers come from `_bmad-output/test-artifacts/story-6-5/repairs/harness3-sol/delivery.md`.
  Lane C delivered 500 of 500 tokens with a 7.4-second worst case at baseline and 27.8 seconds after a 30-second worker stall.
  Lane D's slowest doorbell took 2.24 seconds against a 10-second bound, and HTTP fallback answered within 7.97 seconds against 20.
  The native N1 and N2 matrices come from `repairs/c-doc/N1_N2_EVIDENCE.md`: real OTP sign-in and warm, background and cold notification taps on an Android emulator and an iOS simulator.
  These artifacts are gitignored and exist only on the machine that ran them.
- **No physical device received a push.**
  N3 needs an app-scoped FCM config for `com.couturecast.story65`, APNs credentials, a signed device build and physical devices.
  Android presented notifications through a debug fixture deep link and iOS through `simctl push`.
  The tap and the destination are proven; provider-to-device delivery is open.
- **I found no run of the hosted preview probe.**
  `pw-e2e-trigger` shows no run since 2026-10-16, before the probe existed.
  The 101 upgrade on a protected preview, cross-instance delivery on Vercel, and Fluid Compute duration reconnect remain unproven on hosted infrastructure.
  Lane D proved cross-instance doorbells with three local compiled API processes behind a TCP balancer.
- **The acceptance lanes and the native runner are outside CI.**
  The four `*.acceptance.spec.ts` files need `RUN_STORY65_ACCEPTANCE=true`, and no workflow sets it.
  `scripts/run-story65-native.mjs` has no workflow either.
  The real-session Playwright lane joined `pr-pw-e2e-local.yml` later, in `f7045a7b` (PR #160).
- **Capacity inputs are open.**
  H, the largest real timezone herd, needs a production cohort count, so lane C ran at the floor of 500.
  Production pool limits, the Supavisor budget, and billing and usage exports are open; the lanes used no account access.
- **Offline logout still has a window.**
  The server binding stays live until the owner signs in again, the installation transfers, or 30 days pass, and generic notifications can arrive in that window.
  D5 records this limitation on purpose.
- **Production is off.**
  Both community flags are false, `COMMUNITY_DISPATCH_ENABLED` defaults off, and the `CommunityRuntimeCapability` privacy version defaults to 0.
- **Live code moved after the merge.**
  Authorization concurrency is 5 in `community-realtime.server.ts` today, and `community-authorization-budget.ts` arrived in `67806196` (PR #162).
  The comment-draft and scroll-restore helpers that cite Story 6.5 arrived with Stories 6.6 and 6.7.

Architecture diagram:

```mermaid
flowchart TD
  subgraph Writes["Domain write, one transaction"]
    W["reaction / comment / publication / removal"] --> OB["CommunityDomainOutbox row\nper-post revision"]
    W --> INT["first-occurrence intent\ntombstone even when suppressed"]
  end

  OB --> APP["bounded appender\nsavepoint + SKIP LOCKED\nNOWAIT head lock"]
  APP --> EV["CommunityStreamEvent\npublic lane + private lane"]
  EV --> HEAD["CommunityStreamHead\nepoch + sequence"]

  subgraph Realtime["api/realtime.ts, maxDuration 300"]
    TICK["1 s head check\nrevalidate every 4 to 6 s"] --> BELL["community:changed\nmax 1 per socket per second"]
    TICK --> CTRL["community:availability\ndenied or unavailable"]
  end
  HEAD --> TICK

  BELL --> CLIENT["web + mobile client\nsingle-flight catch-up"]
  CTRL --> CLIENT
  CLIENT --> SYNC["GET /community/events\nPOST /community/targets/resolve"]
  SYNC --> FLAG["CommunityFlagEvaluation\n60 s grant, refresh at 45 s"]
  CLIENT -.->|"socket down"| POLL["fallback catch-up\nevery 5 to 5.5 s"]
  POLL --> SYNC

  INT --> GROUP["recipient group\nquiet hours on real instants\n30 s spacing, 24 h expiry"]
  GROUP --> GUARD["guarded send transaction\nshared privacy locks\ntransaction_timeout 3s, PG17+"]
  GUARD --> SENDING["commit sending attempt"]
  SENDING --> EXPO["one HTTP call to Expo\n2 s deadline"]
  EXPO -->|"accepted"| RCPT["receipts from 15 min\nprune by binding generation"]
  EXPO -->|"ambiguous"| UNK["unknown\nnever resent"]
  EXPO -->|"explicit rejection"| RETRY["retry, max 3 attempts"]

  RCPT --> TAP["OS tap: warm, background, cold"]
  TAP --> SYNC
  ERASE["erasure / consent loss / opt-out"] -->|"exclusive privacy locks"| GUARD
```

## Step 44: Community city spotlight

User/business impact:

A member opening Community now sees which recent looks stand out near them.
The City Spotlight heads the community section on web and the Community tab list on mobile: one horizontal row of ranked cards under a heading with the member's own place name, and View more as the row's last item.
Ranking selects posts published in the last seven days, counts their current non-author reactions and decays with age, so a fresh look with a few reactions can outrank an older one with more.

Location makes this the most privacy-sensitive community surface so far.
A post carries only a coarse area: an ISO country code plus a folded region and city, stamped at submission.
A level shows only when at least five distinct authors have eligible posts there, the response omits the cohort size, and each member gets 30 spotlight reads a minute.
Those controls limit small-cohort disclosure and rapid location probing.
They do not establish a complete defense against re-identification.
The spotlight sits behind the same read gate, rollout flags, consent and age rules as the feed, so production stays dark with it.

Key takeaways:

1. **Pick the narrowest area that hides the individual.**
   Area identity is a hierarchical tuple: city is `(country, region, city)`, region is `(country, region)`, country is `(country)`.
   The service counts distinct eligible authors live and serves the narrowest level with at least 5, falling back from city to region to country, then to `none` with no items.
   Two cities with the same name under different regions stay separate areas.
2. **Canonicalize place text before it becomes an identity.**
   `canonicalCountryCode` in `packages/utils/src/spotlight-area.ts` maps country text to ISO 3166-1 alpha-2 through `Intl.DisplayNames` in the ten product locales plus an alias table.
   Region and city fold through NFKD with combining marks removed, Turkish I folding, transliteration of letters NFKD keeps whole, whitespace collapse and lowercase.
   Text that resolves to no country leaves the post unstamped and the viewer at `none`.
3. **Stamp derived location at write time and clear it with the source.**
   Submission copies the three components from the first country-bearing saved location ordered by `is_primary` descending, then `created_at` ascending.
   Coordinates, `location_key`, labels and timezone stay off the post.
   Anonymization and erasure clear the components in the same update that clears `location_key`, and a CHECK refuses an anonymized row that still has an area.
   Existing posts get no backfill, so they never enter a spotlight.
4. **Invalidate a read model by bumping versions and publish only through compare-and-set.**
   Each area has a Redis version counter, and a global epoch covers events that cannot be mapped to an area.
   A builder reads the version before its database read and publishes its pointer through a Lua compare-and-set on that version, so a rebuild that raced a reaction cannot publish its stale snapshot.
5. **Give each kind of change its own freshness path.**
   A post already in the snapshot is checked live on every page one: a changed `reaction_generation` or a failed visibility check forces a rebuild with no wait.
   A post outside the snapshot changes the answer only after the invalidator consumes its public stream event through a durable cursor that advances after Redis succeeds.
6. **Pin pagination to a digest and refuse anything that moved.**
   The snapshot ID is a SHA-256 of `as_of`, level, area hash and ordered post IDs.
   The HMAC cursor binds member, level, area hash, `as_of`, snapshot ID and next index.
   A later page reads the snapshot by ID or recomputes it at the cursor's `as_of`, rechecks the cohort live, and answers `invalid_cursor` on any mismatch.
7. **Treat the cache as optional.**
   The spotlight Redis client fails fast (`connectTimeout: 1000`, `maxRetriesPerRequest: 1`, no offline queue, `commandTimeout: 500`), and every read falls back to direct database ranking capped at 60.
8. **Make ranking a pure function of data and a pinned clock.**
   `as_of` is the injected clock truncated to the minute, the score is `non_author_reactions / (age_hours + 2)^1.5`, ties break on reactions, `published_at`, then `id`, and the threshold, window, exponent, cap and lifetimes are exported constants pinned by `6.6-UNIT-001`.
9. **A new surface on a shared endpoint gets its own event.**
   `POST .../opened` gained a `surface: 'spotlight'` branch that emits only `community_spotlight_opened`.
   A body without `surface` still emits exactly the old `community_card_opened`, which feeds the Story 6.2 beta gate's arm comparison.

Hard-won lessons from the implementation and code review of this story:

1. **The story review found the invalidation holes before any code existed.**
   The first spec deleted keys from the outbox and rechecked on read.
   The review named three failures: a rebuild that read the database before a reaction committed could write its stale snapshot after the delete, a failed Redis delete after `append()` marked rows done was never retried, and a post outside the snapshot gaining its first reaction moved no generation the read check could see.
   Versioned areas, the global epoch, the compare-and-set and the durable cursor all came from that review (`cc66-opus-story-review.md` finding 1).
2. **Routing spotlight opens through the feed's open event would have corrupted a release gate.**
   `community_card_opened` feeds the beta gate's non-self open lift between experiment arms, and the spotlight is identical for both arms.
   Counting its opens would dilute the lift, and the per-post dedupe would let a spotlight open swallow a later feed open.
   The open contract also had to become one strict refined object, because a schema union failed Optic as a breaking change.
3. **Following the spec literally disabled the cache.**
   The first invalidator bumped the global epoch for every event on a post without area components.
   No post published before the migration is stamped, so routine engagement on the existing catalogue orphaned every pointer for every viewer.
   Three reviewers found it independently (R1); the epoch now moves only for `resync`, a null or missing post, or an anonymized or erasure-requested post, and `6.6-INT-031` pins the no-op.
4. **Free-text places took three review rounds to canonicalize.**
   Round 1 found `USA` and `United States`, `Deutschland`, accented `Sao Paulo` and the Turkish dotted I splitting one place (R22).
   Round 2 added leading articles, `&` as `and`, formal names such as Korea and both Congos, and letters NFKD keeps whole, such as sharp s and slashed o (R32).
   The final test review found that `Sao  Paulo` with two spaces still split from `Sao Paulo` (R47).
5. **Random 63-bit counter seeds exceed what JavaScript and Lua can compare.**
   Counters seed with `SET NX` at a random 63-bit value so a Redis reset never re-matches an old pointer.
   That is past `Number.MAX_SAFE_INTEGER` and past Lua's doubles, so versions and epochs compare as strings everywhere (`6.6-UNIT-016`, `6.6-INT-027`).
6. **A Redis that accepts the connection and stops answering is a different failure from a Redis that is down.**
   Without `commandTimeout`, a stalled server held the read open until the 1950 ms community authorization budget expired and the member got a 503, so the database fallback never ran.
   The test double rejected instantly and could not show it.
   Commands now time out at 500 ms, each invalidation pass races a 2-second budget, a pass still open after four budgets is abandoned, and `community-spotlight-stall.integration.spec.ts` drives the real runtime against a paused Redis proxy (R4, R30, R34).
7. **The privacy test stripped the field that leaked.**
   `community_spotlight_opened` put the raw post ID in its `dedupe_key`, and `6.6-HTTP-011` removed `dedupe_key` before asserting no post ID appeared, so it could not fail (O1, R2).
   The key is now `community_spotlight_opened:<subject token>:<post token>:spotlight` with both tokens as 16-hex HMACs, and the test asserts on the key.
8. **A rate limit and an erasure path each needed a second look.**
   Later pages recheck the cohort live, so a replayed cursor was an unlimited probe until cursor pages counted toward the 30-read limit (R29).
   The read window row holds a raw `user_id`; the first fix deleted it on erasure (R26), and a later review showed a read already past the gate could recreate it after erasure committed (A2).
   `recordRead` now takes the member's privacy advisory lock in shared mode and rechecks the community subject under it (R41).
9. **A read ticket taken when the response arrives fences nothing.**
   Web created its reaction-state ticket in the reconciliation callback, so a spotlight response that started before a realtime eviction got a newer ticket and restored the removed post (A1).
   Web now takes the ticket before each request, as mobile already did, and `6.6-WEB-069` and `6.6-WEB-070` deliver the eviction mid-flight.
10. **The spotlight had no real data source.**
    No web or mobile path wrote `SavedLocation`, so outside the seeds every real member resolved to `none`, and the daily ritual also threw without a saved location (R23).
    The coordinator split that gap into Story 1.2b, client location capture, which is Step 45.
11. **Six stacked full cards put the first feed card about 11,000 px down on mobile.**
    An owner decision (R42) turned the module into one horizontal row on both platforms, with list semantics, position and count on every rank, and View more as the trailing item.
    The same work found that bare `1fr` grid tracks in the Lookbook Prism layout let the hero's chip row crush the community column to about 160 px at 1280 px and wider; the tracks are now `minmax(0, 1fr)`.
12. **The tests as first written scored 29 out of 100.**
    The final test review found one assertion that could not fail (`6.6-WEB-068` compared an unmounted hook's state with itself), two hard waits, three shape-only assertions, a wall-clock grant expiry, a module counter that broke shuffled runs and a 1086-line suite.
    After test-only remedies it scored 86, and each strengthened test was shown to go red on a one-line production break (`cc66-tea-final-test-review.md`).
13. **The new flows exposed a Story 6.5 defect.**
    After a socket drop, the client's own 2-second abort of a request the server had answered with 200 was reported as `unavailable`, which hid the feed and lost the reader's scroll position with every call succeeding.
    Failures with no server status now report `recovering`, the 8-second privacy window still decides when content hides, and web and mobile restore the scroll position when the same items return (R43).

Story/Task mapping:

The spec's Execution list is unnumbered; the items follow its order.

- Item 1, schema and migrations: area columns, hierarchical and anonymization CHECKs, window indexes, the API-only `CommunitySpotlightCursor` and `CommunitySpotlightReadWindow` with RLS.
- Item 2, stamping at submission and clearing in the erasure sweep: `community.service.ts`, `community.repository.ts`, `community-maintenance.service.ts`, `community-privacy.ts`.
- Item 3, the spotlight core: `community-spotlight-area.ts`, `community-spotlight-ranking.ts`, `community-spotlight.repository.ts`, `community-spotlight-cache.ts`, `community-spotlight-invalidator.ts`, `community-spotlight-cursor.ts`, `community-spotlight.service.ts`, and the invalidator hook in `community-engagement.runtime.ts`.
- Item 4, contract: `GET /api/v1/community/spotlight` and the opened `surface` branch in `community.ts` and `openapi.ts`, with OpenAPI and SDK regenerated.
- Item 5, controller and module wiring: `community.controller.ts`, `community.module.ts`.
- Item 6, telemetry: two strict spotlight events in `analytics-events.ts` and `telemetry.service.ts`.
- Item 7, clients: the web and mobile wrappers, modules, View more focus and announcements.
- Item 8, locales: `community.spotlight.*` in all 20 catalogs.
- Item 9, seeds and factories: `packages/db/prisma/seeds/community-spotlight.ts`, `packages/testing/src/factories/community-spotlight.factory.ts`.
- Item 10, tests at every tier listed below.

Story reference:

- `_bmad-output/implementation-artifacts/spec-6-6-community-city-spotlight.md`, whose Implementation Notes record the privacy model, the canonical area rules, the query plans and every change made outside the story's own surface.
- `_bmad-output/test-artifacts/story-6-6/reviews/code-triage-1.md`, one row per review finding from R1 to R47 with its verdict and owner.
- `_bmad-output/test-artifacts/story-6-6/reviews/cc66-tea-final-test-review.md` for the test-quality score before and after remedies.

Cross-links:

- Step 38 for the feed, its read gate, the pseudonymous aliases and the visibility predicate the spotlight reuses.
- Step 41 (Story 6.3 reactions, PR #153) for `reaction_generation` and the reaction summaries negotiated through `x-couture-reactions`.
- Step 43 (Story 6.5 realtime engagement, PR #157) for the public `CommunityStreamEvent` stream the invalidator consumes, and for the sync state R43 repaired.
- Step 19 for the ritual Redis client options and soft-failure precedent the spotlight client copies.
- Step 8 for the strict analytics registry and its privacy allowlists.
- Step 22 for locale parity and Step 28 for the focus and announcement rules.
- Step 45 for the client location capture that gives real members an area.
- Step 46 for the Home teaser that reads this spotlight with `surface=home_teaser`, and Step 47 for the sponsorship block added to its cards.

Sequence to follow:

1. `packages/utils/src/spotlight-area.ts`: how text becomes an ISO country and folded region and city.
   The doc comment on the area columns in `packages/db/prisma/schema.prisma` still says NFKC; the code folds with NFKD.
2. `packages/db/prisma/migrations/20261022120000_community_city_spotlight/migration.sql`, `20261022130000_community_spotlight_read_limit/migration.sql` and `20261022140000_community_spotlight_window_indexes/migration.sql`: columns, CHECKs, RLS and the indexes each level reads through.
3. `apps/api/src/modules/community/community-spotlight-ranking.ts`: the pinned constants and the pure score.
4. `apps/api/src/modules/community/community-spotlight.repository.ts`: cohort and ranking in one repeatable-read transaction, and the locked read window.
5. `apps/api/src/modules/community/community-spotlight-cache.ts`: string counters, `SET NX` seeds, the Lua compare-and-set and the client options.
6. `apps/api/src/modules/community/community-spotlight-invalidator.ts`, then the hook in `community-engagement.runtime.ts`.
7. `apps/api/src/modules/community/community-spotlight-cursor.ts` and `community-spotlight.service.ts`: level resolution, snapshot freshness, later pages and the open path.
8. `packages/api-client/src/contracts/http/community.ts`: the spotlight schemas and the refined opened body.
9. `apps/web/src/app/components/community-spotlight.tsx`, then `apps/mobile/src/features/community/use-community-spotlight.ts` and `apps/mobile/components/community/community-spotlight-module.tsx`.

Task owner map:

- Story 6.6 area owner: canonical country codes and region and city folding in `packages/utils/src/spotlight-area.ts`.
- Story 6.6 level owner: hierarchical levels and area hashes in `apps/api/src/modules/community/community-spotlight-area.ts`.
- Story 6.6 schema owner: area columns, CHECKs, cursor and read-window tables in `packages/db/prisma/schema.prisma` and `packages/db/prisma/migrations/20261022120000_community_city_spotlight/migration.sql`.
- Story 6.6 index owner: per-level window indexes and the covering reaction index in `packages/db/prisma/migrations/20261022140000_community_spotlight_window_indexes/migration.sql`.
- Story 6.6 stamping owner: copy the author's coarse area at submission in `apps/api/src/modules/community/community.service.ts`.
- Story 6.6 erasure owner: delete the read window with the community subject in `apps/api/src/modules/community/community-privacy.ts`.
- Story 6.6 ranking owner: score, window and constants in `apps/api/src/modules/community/community-spotlight-ranking.ts`.
- Story 6.6 repository owner: eligibility, cohort, ranking and the locked read limit in `apps/api/src/modules/community/community-spotlight.repository.ts`.
- Story 6.6 cache owner: the Redis read model and compare-and-set in `apps/api/src/modules/community/community-spotlight-cache.ts`.
- Story 6.6 invalidator owner: durable cursor, version and epoch bumps in `apps/api/src/modules/community/community-spotlight-invalidator.ts`.
- Story 6.6 cursor owner: signed cursors bound to member, area and snapshot in `apps/api/src/modules/community/community-spotlight-cursor.ts`.
- Story 6.6 service owner: reads, snapshots, fallback and analytics in `apps/api/src/modules/community/community-spotlight.service.ts`.
- Story 6.6 contract owner: spotlight schemas, the read-limit refusal and the opened branch in `packages/api-client/src/contracts/http/community.ts`.
- Story 6.6 analytics owner: the two strict spotlight events in `packages/api-client/src/types/analytics-events.ts`.
- Story 6.6 retry owner: one bounded retry after the read gate's unavailable 503 in `packages/api-client/src/community-unavailable-retry.ts`.
- Story 6.6 web owner: the module, View more, focus and announcements in `apps/web/src/app/components/community-spotlight.tsx`.
- Story 6.6 mobile state owner: paging, identity changes and eviction in `apps/mobile/src/features/community/use-community-spotlight.ts`.
- Story 6.6 mobile module owner: the horizontal carousel in `apps/mobile/components/community/community-spotlight-module.tsx`.
- Story 6.6 mobile detail owner: the detail a spotlight card opens in `apps/mobile/components/community/community-spotlight-detail.tsx`.
- Story 6.6 fixture owner: the shared seeded cohort in `packages/db/prisma/seeds/community-spotlight.ts` and per-test cohorts in `packages/testing/src/factories/community-spotlight.factory.ts`.

Tests that cover this step:

Test IDs below are from the files at `1d4ad0c2`.

Shared utility and fixture unit tests:

- [`packages/utils/src/spotlight-area.spec.ts`](../../packages/utils/src/spotlight-area.spec.ts): resolves one country from codes, aliases and every locale, keeps unknown text unresolved, round-trips every country name, and folds region and city spellings to one form.
- [`packages/testing/test/community-spotlight.factory.spec.ts`](../../packages/testing/test/community-spotlight.factory.spec.ts): per-test cohorts take unique real countries and survive shuffled runs.

Database RLS tests:

- [`packages/db/test/rls/community-posts.spec.ts`](../../packages/db/test/rls/community-posts.spec.ts): `6.6-DB-RLS` and `6.6-DB-RLS-002` refuse every client role the invalidator cursor and the read windows.

Contract and analytics tests:

- [`packages/api-client/testing/community-analytics.spec.ts`](../../packages/api-client/testing/community-analytics.spec.ts): the two spotlight events carry only platform, dedupe key, level and count or rank; `6.6-CON-002` refuses an open at level `none`.
- [`packages/api-client/testing/community-publication-contract.spec.ts`](../../packages/api-client/testing/community-publication-contract.spec.ts): `6.6-CON-001` accepts the spotlight open only with a rank from 1 to 60, a served level and no experiment variant.
- [`packages/api-client/testing/community-unavailable-retry.spec.ts`](../../packages/api-client/testing/community-unavailable-retry.spec.ts): `6.6-CON-010` to `014` wait the advised seconds, retry once, and respect aborts.

API unit tests:

- [`apps/api/src/modules/community/community-spotlight.spec.ts`](../../apps/api/src/modules/community/community-spotlight.spec.ts): `6.6-UNIT-001` to `017` pin the constants, score, minute truncation, window edges, tie order, snapshot digest, area folding, cursor binding, HMAC dedupe keys and string counters.
- [`apps/api/src/modules/community/community-spotlight-invalidator.spec.ts`](../../apps/api/src/modules/community/community-spotlight-invalidator.spec.ts): `6.6-UNIT-030` to `039` map events to versions or the epoch, defer on failure, and bound or abandon a stalled pass.
- [`apps/api/src/modules/community/community-spotlight.controller.spec.ts`](../../apps/api/src/modules/community/community-spotlight.controller.spec.ts): `6.6-UNIT-060` to `065` cover limits, the 429 with `Retry-After`, and routing each open body to its own path.
- [`apps/api/src/modules/community/community-engagement.runtime.spec.ts`](../../apps/api/src/modules/community/community-engagement.runtime.spec.ts): `6.6-UNIT-040` and `041` run the invalidator after `append()` and keep a stalled Redis away from the append loop and shutdown.
- [`apps/api/src/modules/community/community.service.publishing.spec.ts`](../../apps/api/src/modules/community/community.service.publishing.spec.ts): `6.6-UNIT-050` stamps only the author's normalized coarse area.

Real-PostgreSQL and owned-Redis integration tests:

- [`apps/api/integration/community-spotlight-ranking.integration.spec.ts`](../../apps/api/integration/community-spotlight-ranking.integration.spec.ts): `6.6-INT-001` to `014` walk the ranking rows of the I/O matrix, prove SQL scores equal the pure formula, and assert the partial indexes exist.
- [`apps/api/integration/community-spotlight-invalidation.integration.spec.ts`](../../apps/api/integration/community-spotlight-invalidation.integration.spec.ts): `6.6-INT-020` to `031` cover immediate rebuild for snapshot posts, the invalidator path, the compare-and-set race, epoch bumps, the retention floor, counters past 2^53, TTLs and the Redis-down recompute.
- [`apps/api/integration/community-spotlight-paging.integration.spec.ts`](../../apps/api/integration/community-spotlight-paging.integration.spec.ts): `6.6-INT-040` to `046` page by index without repeats, refuse foreign and stale cursors, fall to region after an erasure, and `6.6-INT-070` pins 30 reads a minute with cursor pages counted.
- [`apps/api/integration/community-spotlight-area.integration.spec.ts`](../../apps/api/integration/community-spotlight-area.integration.spec.ts): `6.6-INT-050` to `055` cover stamping, the database CHECKs, clearing on erasure, and the components kept on withdrawal and consent suspension.
- [`apps/api/integration/community-spotlight-stall.integration.spec.ts`](../../apps/api/integration/community-spotlight-stall.integration.spec.ts): `6.6-INT-060` to `062` fall back within the command timeout and keep the real runtime appending and shutting down against a paused Redis.
- [`apps/api/integration/community-spotlight-http.integration.spec.ts`](../../apps/api/integration/community-spotlight-http.integration.spec.ts): `6.6-HTTP-001` to `014` cover headers, limits, refusals identical to the feed, one deduplicated view, and the spotlight and legacy open branches with no raw identifier.
- [`apps/api/integration/community-erased-subject-denial.integration.spec.ts`](../../apps/api/integration/community-erased-subject-denial.integration.spec.ts): an erased member's read window is gone and stays gone behind the refused spotlight route.

Web component tests:

- [`apps/web/src/app/components/community-spotlight.test.tsx`](../../apps/web/src/app/components/community-spotlight.test.tsx): heading, rank order, the open path, empty, disabled and age-gate states, cross-copy reactions, keyboard open and Escape, and axe.
- [`apps/web/src/app/components/community-spotlight.paging.test.tsx`](../../apps/web/src/app/components/community-spotlight.paging.test.tsx): View more focus and single announcement, cursor restart, empty-page rules, single-image retry, and the row's list semantics.
- [`apps/web/src/app/components/community-spotlight.realtime.test.tsx`](../../apps/web/src/app/components/community-spotlight.realtime.test.tsx): realtime removal of spotlight-only posts, the hidden state while access is unverified, and the return of every loaded page.
- [`apps/web/src/app/components/community-spotlight.review.test.tsx`](../../apps/web/src/app/components/community-spotlight.review.test.tsx): eviction of the author's own unpublished post and per-surface image failures.
- [`apps/web/src/app/components/community-spotlight.hook.test.tsx`](../../apps/web/src/app/components/community-spotlight.hook.test.tsx): late results after a reset or session change are dropped, and `6.6-WEB-069` and `070` keep an evicted post out when the eviction lands mid-request.
- [`apps/web/src/lib/community-spotlight.test.ts`](../../apps/web/src/lib/community-spotlight.test.ts): the wrapper negotiates reactions, retries once after a gate 503, classifies refusals, and sends rank and served level.

Mobile component and screen tests:

- [`apps/mobile/components/community/community-spotlight-module.test.tsx`](../../apps/mobile/components/community/community-spotlight-module.test.tsx): heading, rank labels, carousel layout and sizing, View more scroll and focus, and axe.
- [`apps/mobile/src/features/community/community-spotlight-detail.test.tsx`](../../apps/mobile/src/features/community/community-spotlight-detail.test.tsx): the detail takes focus and announces once per open.
- [`apps/mobile/src/screens/community-screen.test.tsx`](../../apps/mobile/src/screens/community-screen.test.tsx) runs [`spotlight.cases.tsx`](../../apps/mobile/src/test-utils/community-screen/spotlight.cases.tsx) and [`spotlight-review.cases.tsx`](../../apps/mobile/src/test-utils/community-screen/spotlight-review.cases.tsx): `6.6-MOB-001` to `081` cover every state, identity changes, realtime eviction, image re-reads, focus return and the failed first identity resolution.

Story 6.5 repair carried by this PR:

- [`packages/api-client/testing/community-sync-state.spec.ts`](../../packages/api-client/testing/community-sync-state.spec.ts): failures without a server status report `recovering`, and content still hides at the 8-second bound.
- [`apps/web/src/app/components/community-scroll-restore.test.ts`](../../apps/web/src/app/components/community-scroll-restore.test.ts) and [`apps/mobile/src/features/community/use-community-scroll-restore.test.ts`](../../apps/mobile/src/features/community/use-community-scroll-restore.test.ts): scroll returns only when the same items come back.

Pact contract tests:

- [`pact/http/consumer/interactions/community/spotlight.ts`](../../pact/http/consumer/interactions/community/spotlight.ts), run by [`web-api-client.pacttest.ts`](../../pact/http/consumer/web-api-client.pacttest.ts) and [`mobile-api-client.pacttest.ts`](../../pact/http/consumer/mobile-api-client.pacttest.ts): populated and empty spotlights, page two by cursor, a forged cursor, the rollout refusal, and both open branches.
- [`pact/http/provider/api-provider.pacttest.ts`](../../pact/http/provider/api-provider.pacttest.ts): replays those interactions against the real Nest controllers with scenario-controlled service doubles.

Playwright end-to-end tests:

- [`playwright/tests/community-spotlight.spec.ts`](../../playwright/tests/community-spotlight.spec.ts): the seeded cohort heads the section, keyboard View more focuses and announces once, an open records only the spotlight event, one row at 390 and 1280 px, and the empty state for a viewer with no saved location.
- [`playwright/tests/lookbook-prism.spec.ts`](../../playwright/tests/lookbook-prism.spec.ts): the hero and community columns stay even and on screen at 1280 and 1440 px.

Mobile end-to-end tests:

- [`maestro/community-spotlight.yaml`](../../maestro/community-spotlight.yaml): a member saved in Chicago, Illinois, United States sees the seeded cohort, rank 1 first, and a second page through View more.
- [`maestro/community-feed.yaml`](../../maestro/community-feed.yaml): the feed ordering check still passes with the spotlight above it.

Evidence boundaries:

- **Source-comment follow-up.**
  40 of the 40 linked source files in this test map lack a Step 44 cross-link comment in the reviewed Git snapshot.
  This document-only review leaves those source comments for a repository change.

- **Local review artifacts.**
  The cited `story-*` review records are retained locally under `_bmad-output/test-artifacts/` and ignored by Git.
  A fresh checkout can use the tracked story spec as the portable account of those findings.

- **Every pass count here is reported.**
  The final test review lists, at `7f8b62e1`, API 10 files and 95 of 95, web 12 files and 113 of 113, and mobile 12 files and 214 of 214 (`cc66-tea-final-review.md`).
  The spec records the merge-ready head `890ab140`, three reviewers READY on `ab2e904d`, the carousel flows passing on a local iOS simulator (`runs/ios-community-r42-1`) and Android left to CI.
  None of them was rerun for this step, and the CI runs were not read.
- **The query-plan numbers are one synthetic measurement.**
  On PostgreSQL 17 with 50,000 posts and 529,466 reactions, the cohort query went from 34.9 ms to 18.2 ms and the country ranking from 51.6 ms to 34.6 ms after the window indexes (`runs/r21-explain/`).
  No production-scale data exists to repeat it.
- **At merge, real members had no area.**
  Until Step 45 shipped, no client wrote a saved location, so only seeded and test members could see a ranked spotlight.
- **The end-to-end tiers cannot tell score order from recency.**
  The seed orders recency and reactions the same way, so a spotlight served newest-first would still pass Playwright and Maestro.
  Score order is proven against real SQL by `6.6-INT-012` and `6.6-INT-014`.
- **Invalidation is proven at the integration tier only.**
  Every browser and device journey reads the shared cohort without reacting, so no end-to-end test watches a reaction move a rank.
- **Six medium and two low test-quality findings remain**, mostly inline payloads that bypass existing factories and one multi-concern test (`6.6-WEB-001`).
- **The five-author cohort and the read limit are the whole privacy argument.**
  No re-identification analysis beyond the reviews exists.
- **Both community rollout flags stay false.**

Architecture diagram:

```mermaid
flowchart TD
  Sub["Post submission"] --> Stamp["Stamp area_country, area_region, area_city\nfrom country-bearing saved locations\nprimary first, then oldest created_at"]
  Read["GET /api/v1/community/spotlight"] --> Gate["Feed read gate\nflags, consent, age, erasure"]
  Gate --> Limit["Read window\n30 reads a minute, cursor pages count"]
  Limit --> Level{"Live cohort count\n5 distinct authors?"}
  Level -- "city, else region, else country" --> Ptr["Area pointer\nkey embeds epoch, level, area hash"]
  Level -- "no level" --> None["level none, no items"]
  Ptr -- "missing or version moved" --> Build["Repeatable-read rank\nscore = reactions / (age_hours + 2)^1.5\ncap 60"]
  Build --> CAS["Lua compare-and-set\non the area version read before the build"]
  Ptr -- "current" --> Fresh{"Every entry visible\nand reaction_generation unchanged?"}
  Fresh -- "no" --> Build
  Fresh -- "yes" --> Page["Page of up to 12\nsigned cursor binds member, area, as_of, snapshot id"]
  CAS --> Page
  Ptr -. "Redis down or stalled past 500 ms" .-> DB["Direct database ranking"]
  DB --> Page
  Stream["Public CommunityStreamEvent append"] --> Inv["Spotlight invalidator\ndurable cursor, 2 s budget"]
  Inv -- "stamped post" --> Ver["INCR city, region, country versions"]
  Inv -- "resync, missing, anonymized or erased post" --> Epoch["INCR global epoch"]
  Ver -.-> Ptr
  Epoch -.-> Ptr
```

## Step 45: Client location capture

User/business impact:

Until this story no web or mobile screen could save a location.
Every real member had zero saved locations, so the daily ritual answered 400 "No location preferences found for user", the community climate band stayed unresolved, and City Spotlight never stamped an area on a post.
Story 1.2 had built the locations API in epic 1, but it trusted the client to send coordinates, timezone, city and country, and no client ever called it.

Story 1.2b is an epic 1 story delivered between Story 6.6 and Story 6.7.
`epics.md` says it was "found during CC-6.6 review": Step 44's spotlight, Step 38's climate band and Step 19's ritual all read a saved location that no member could create.

A member now searches for a city, picks one candidate and saves it.
The server makes one forecast call during the save and stores the result as the location's weather snapshot, so the location is weather-ready when the request returns.
Web gets a Locations section on `/settings`; mobile gets a Locations screen pushed from Settings.
Both list, add, switch primary in one press, rename and delete, in ten locales.
The mobile hero no-location state and the web and mobile Community `no_location` band state offer "Add a location", and the surface that sent the member there reloads after the save.

Key takeaways:

1. **The server owns every field that matters.**
   Search returns candidates from the configured provider's geocoding (OpenWeather `direct` or WeatherAPI `search.json`, existing keys only).
   Each candidate carries a `candidateToken`: an HMAC over city, region, ISO country and rounded coordinates, valid for 15 minutes, with no member identity in it.
   The save endpoint takes only `{ candidateToken, label }`, so the client cannot supply coordinates, timezone or country on this path.
2. **Weather-ready is part of the save.**
   `saveFromSearch` calls the provider once with a 3-second timeout, validates the IANA timezone against `Intl`, and checks that the daily projection holds the climate band's minimum usable days, read back exactly as Community reads them.
   Any failure saves nothing and answers a typed retryable 503.
   The snapshot is written inside the location's own transaction through `persistForecastWithin`, so a save that loses the limit or duplicate race leaves no snapshot behind.
3. **Build the key from locale-independent fields, then append the coordinates.**
   `buildSearchLocationKey` folds the provider's default name, region and ISO country to ASCII (NFKD, marks removed, Turkish I folded) and always ends with the stored three-decimal coordinates and hemisphere letters, for example `41-871n-87-631w`.
   Springfield IL and Springfield MO get two keys, a Japanese display label and an English one get the same key, and name parts are shortened before the coordinates ever are, to fit the 120-character `locationKeySchema` limit.
4. **A token replayed by someone else saves into the caller's collection.**
   The token is identity-free on purpose.
   A bad signature, another environment's secret and an expired token all fail alike with 400, and a missing `LOCATION_CANDIDATE_SECRET` in a deployed environment fails closed with 503 on both endpoints.
5. **Switching primary refreshes weather only when it needs to.**
   Switching, and the promotion that follows deleting the primary, enqueue `weather-refresh-location` when the snapshot is absent or older than 5 minutes.
   `WeatherRefreshQueue` shares the worker's bucketed job id, bounds the enqueue to 1 second, and never fails the request.
6. **Analytics names the outcome and nothing about the place.**
   `location_saved` and `location_search_failed` carry the HMAC subject, outcome, platform and a result count.
   The existing `location_switched` event lost its place-key properties and became pseudonymous, because this story ships its first caller.
   Search queries are never logged, and search is limited to 30 requests per member per minute through a `LocationSearchWindow` row with API-only RLS.
7. **Turn test weather off for locations saved weather-ready.**
   The ritual's test-environment weather fallback is skipped for any key that `isSearchLocationKey` recognises, so an acceptance test can only pass on the forecast the save persisted.
8. **Prove the end-to-end chain with a deterministic provider double.**
   `scripts/weather-provider-double.mjs` serves geocoding and forecast to the local Playwright lane and to Maestro.
   Provider origin overrides (`OPENWEATHER_API_ORIGIN`, `WEATHERAPI_API_ORIGIN`) are ignored whenever `isProductionRuntime` holds, and `VERCEL_ENV=production` wins over whatever `APP_ENV` or `DEPLOY_ENV` say.

Hard-won lessons from the implementation and code review of this story:

1. **The first spec would have shipped a location with no weather and a test that passed anyway.**
   Both story reviewers rated it High.
   Weather ingests primary locations only and asynchronously, so a fresh save had no snapshot and the ritual would answer "Weather data is temporarily unavailable."
   In `TEST_ENV=local` and `preview` the ritual fabricated a mock snapshot, so Playwright and Maestro would have shown a ritual even if the refresh never ran.
   The fix was the synchronous save-time forecast and the fallback bypass in takeaway 7 (`cc12b-opus-story-review.md` finding 1, `cc12b-astra-story-review.md` finding 1).
2. **A slug of the city name is a shared weather key.**
   Snapshots are keyed by `location_key` across all members, and `normalizeLocationKey` kept only `[a-z0-9]`.
   Paris FR and Paris TX would have shared one member's weather, the tilde in Sao Paulo became a hyphen (`s-o-paulo`), and a non-Latin display label became an empty key and a 400.
   The derivation in takeaway 3 came out of that review (`cc12b-opus-story-review.md` finding 2).
3. **A save that passed timezone validation could still fail the climate band.**
   The first implementation persisted any forecast with a valid timezone.
   Code review round 1 (R3, High) required the band's minimum usable days before persisting, and CAP-08 was rewritten to fail on the old behaviour.
4. **Writing the snapshot before the location row left orphans on a lost race.**
   R11 moved the snapshot into the location's transaction.
   The first race test could not fail: `Promise.all` did not force both saves through their preflight reads before one committed, so the pre-fix order passed with one snapshot.
   R16 added a barrier inside the forecast call that holds both saves after preflight and before either commits, and INT-17 now goes red on the pre-R11 code every time.
5. **An unawaited cache write can resurrect a deleted primary.**
   On mobile, `saveRitualCache` wrote its latest-location pointer without waiting, so the pointer could land after `forgetLatestRitual` and a cold mount restored the old primary's ritual (R7).
   The first fix used `Promise.all`, which released the per-member queue as soon as one write rejected while the pointer write was still in flight (R7b).
   Every mutation now holds the queue until all its writes settle (`Promise.allSettled`), and an invalidation bumps a generation that makes an older queued save skip its pointer (MOB-CACHE-01 to 05).
6. **The Pact provider tested its own doubles.**
   TEA phase 2 found provider verification replacing `LocationCaptureService` and `LocationPreferencesService` whole, so every status and code came from the double: "expired candidate" sent the success token and "three saved locations" listed nothing (S2).
   The provider now runs the real services and fakes only the repositories, geocoder, forecast provider, telemetry, clock and refresh queue.
7. **Several guarantees had tests that could not fail on the break they claimed to cover.**
   The TEA review scored the suite 61/100 at `1d70b156` and listed them with a one-line red-proof break each.
   The 15-minute token lifetime was computed from the same constant it tested, the 3-second save timeout was asserted as `expect.any(AbortSignal)`, a 0 ms debounce passed the debounce tests, and the combobox keyboard test used one candidate, where ArrowDown is `(0+1)%1`.
   Each now uses literal boundaries, fake timers or two candidates, and was proven red on a one-line production break (`cc12b-tea-test-review.md`, Phase 2 outcome).
8. **The Maestro flow was a coin flip.**
   The community experiment assigns members to the `auto` or `all` arm by a hash of the member id, and only `auto` names the viewer's band.
   A random signup put the flow's band check in the `all` arm half the time, where `assertNotVisible community-band-unresolved` cannot fail (CI job 120178429887).
   The runner now signs up until the member lands on `auto`, and the flow selects the Your climate filter before reading the band.
9. **Weather job ids with colons failed every sweep enqueue.**
   BullMQ 5 rejects a custom id containing a colon unless it has exactly three segments, and the `name:key:iso` form carried an ISO timestamp with two colons of its own.
   Ids are now `name__key__bucketMs`, proven against real Redis.
10. **The provider double could be bypassed without anyone noticing.**
    The launcher skipped the double when both origins were preset, with no loopback check, and Maestro reused any healthy API on port 4000 (S3).
    The launcher now refuses non-loopback origins and overwrites keys with dummies, and the Maestro runner reads the double's request log after the flow and fails it unless this run's search reached the double and a forecast was fetched at the sentinel place's own coordinates.
11. **The API test tier failed by machine size.**
    Prisma sizes its pool from the core count, so a 14-core laptop exhausted a 100-connection local Postgres, and one Vitest worker per core blew the DB-backed suites' wall-clock budgets: 1 to 15 failures per full run, each file green alone.
    `apps/api/vitest.config.ts` now pins `connection_limit=9` and caps workers at four.
12. **`.env.local` silently redirected an isolated test stack.**
    `load-env.ts`, `prisma-migrate-deploy.mjs` and the Playwright environment loader each re-applied `.env.local` with override, so a launcher's explicit `DATABASE_URL` was discarded for the default local database.
    The first fix only activated in the launcher child, so the runner and workers still overwrote it (R22b).
    All three now share `scripts/lib/caller-owned-env.mjs`, and the real `test:pw-local` path is tested with no stubbed list.
13. **Expo Go raised its own developer menu and swallowed every tap.**
    Expo Go 54 opens its onboarding sheet two seconds after an experience loads, and Maestro's `clearState` resets onboarding before every flow (R24).
    Android deep links now launch Expo Go with `EXKernelDisableNuxDefaultsKey` through a runner endpoint; a CI experiment showed the sheet on every launch without it and on 0 of 80 with it.

Story/Task mapping:

- Story 1.2b, epic 1, merged as `27041941` (PR #159); the spec's Execution list is unnumbered, so the task numbers below follow its order.
- Task 1 (search and from-search contracts, OpenAPI and SDK): `packages/api-client/src/contracts/http/locations.ts`, `packages/api-client/docs/http.openapi.json`, `packages/api-client/src/generated/apis/LocationsApi.ts`.
- Task 2 (geocoding clients beside the weather providers): `location-geocoding.ts`, `openweather-geocoding.client.ts`, `weatherapi-geocoding.client.ts`, `weather-provider-origin.ts`.
- Task 3 (endpoints, candidate token, rate limit, refresh enqueue, analytics): the `location-preferences` module, `weather-refresh.queue.ts`, `telemetry.service.ts`, and the `LocationSearchWindow` migration.
- Task 4 (web Locations section and guided entry): `apps/web/src/app/components/locations/`, `apps/web/src/lib/locations.ts`, `community-lookbook-grid.tsx`.
- Task 5 (mobile Locations screen and guided entry): `apps/mobile/src/features/locations/locations-screen.tsx`, `apps/mobile/app/locations.tsx`, `apps/mobile/src/lib/locations.ts`, the hero in `apps/mobile/app/(tabs)/index.tsx`, `community-screen.tsx`.
- Task 6 (all 20 locale catalogs and parity specs).
- Task 7 (unit, real-database integration with provider doubles, Pact, Playwright with axe, Maestro, and the end-to-end proof): every file in the test map below, plus `scripts/weather-provider-double.mjs` and the `FLOW_STATE_HOOKS` in `scripts/run-maestro.mjs`.

Story reference:

- `_bmad-output/implementation-artifacts/spec-1-2b-client-location-capture.md`, whose Implementation Notes record the decisions the spec left open, the review-round changes, and the flake root causes R24 to R30.
- `_bmad-output/planning-artifacts/epics.md`, Story CC-1.2b.
- `_bmad-output/implementation-artifacts/spec-1-2-multi-location-preferences.md` for the locations API this story builds on.
- `_bmad-output/test-artifacts/story-1-2b/reviews/`, in particular `cc12b-opus-story-review.md`, `cc12b-astra-story-review.md`, `code-triage-1.md` (R1 to R30) and `cc12b-tea-test-review.md`.

Cross-links:

- Step 16 for weather ingestion and the snapshot this story now writes at save time.
- Step 18 for the telemetry baseline that defined `location_switched`, which this story made pseudonymous.
- Step 19 for the ritual that answered 400 with no location and now reads the persisted forecast.
- Step 22 for the ten-locale parity gates, and Step 28 for the keyboard and screen-reader baseline the combobox follows.
- Step 38 for the climate band and its `no_location` state, which now carries the guided action.
- Step 44 for the spotlight area folding (`foldAreaComponent`, `canonicalCountryCode`) the stored city, region and ISO country must satisfy, and for the review that found this story.
- Step 46, the next story, whose Home teaser reads a spotlight that real members can now reach.

Sequence to follow:

1. `packages/api-client/src/contracts/http/locations.ts` for the search, from-search and typed error contracts, and why responses strip unknown keys while requests stay strict.
2. `apps/api/src/modules/weather/providers/location-geocoding.ts` and the two geocoding clients for provider selection, the 3-second timeout and ISO country resolution.
3. `apps/api/src/modules/location-preferences/location-candidate-token.ts` and `location-key.ts` for the signed candidate and the key derivation.
4. `apps/api/src/modules/location-preferences/location-capture.service.ts`, `saveFromSearch` and `fetchSaveForecast`, for the order of checks, the save-time forecast and the transactional snapshot.
5. `apps/api/src/modules/location-preferences/location-preferences.service.ts` and `apps/api/src/modules/weather/weather-refresh.queue.ts` for the primary-switch refresh.
6. `apps/api/src/modules/personalization/ritual.service.ts` for the `isSearchLocationKey` fallback bypass.
7. `apps/web/src/app/components/locations/location-search-form.tsx` and `locations-section.tsx`, then `apps/mobile/src/features/locations/locations-screen.tsx` and `apps/mobile/src/lib/ritual-cache.ts`.
8. `scripts/weather-provider-double.mjs`, then `playwright/tests/location-capture.spec.ts` and `maestro/location-capture.yaml` for the acceptance harness.

Task owner map:

- Story 1.2b contract owner: search, from-search and typed location error schemas in `packages/api-client/src/contracts/http/locations.ts`.
- Story 1.2b analytics owner: `location_saved`, `location_search_failed` and the pseudonymous `location_switched` in `packages/api-client/src/types/analytics-events.ts`.
- Story 1.2b schema owner: the per-member search window with API-only RLS in `packages/db/prisma/migrations/20261023090000_location_search_window/migration.sql`.
- Story 1.2b geocoding owner: provider selection and candidate normalization in `apps/api/src/modules/weather/providers/location-geocoding.ts`.
- Story 1.2b provider origin owner: double-only origin overrides and production detection in `apps/api/src/modules/weather/providers/weather-provider-origin.ts`.
- Story 1.2b candidate token owner: HMAC signing, 15-minute expiry and fail-closed secret resolution in `apps/api/src/modules/location-preferences/location-candidate-token.ts`.
- Story 1.2b location key owner: folded, coordinate-suffixed keys and `isSearchLocationKey` in `apps/api/src/modules/location-preferences/location-key.ts`.
- Story 1.2b capture owner: search, rate limit, save-time forecast and transactional snapshot in `apps/api/src/modules/location-preferences/location-capture.service.ts`.
- Story 1.2b clock owner: the injected `LOCATION_CLOCK` shared by both location services in `apps/api/src/modules/location-preferences/location-clock.ts`.
- Story 1.2b primary refresh owner: stale-snapshot refresh on switch and delete promotion in `apps/api/src/modules/location-preferences/location-preferences.service.ts`.
- Story 1.2b refresh queue owner: the bounded, bucketed enqueue in `apps/api/src/modules/weather/weather-refresh.queue.ts`.
- Story 1.2b job id owner: the colon-free weather location job id in `apps/api/src/modules/weather/weather-processor.ts`.
- Story 1.2b ritual owner: skipping test weather for search-saved keys in `apps/api/src/modules/personalization/ritual.service.ts`.
- Story 1.2b web owner: the combobox search in `apps/web/src/app/components/locations/location-search-form.tsx` and the section in `apps/web/src/app/components/locations/locations-section.tsx`.
- Story 1.2b web guided entry owner: the Community add-location link and safe return path in `apps/web/src/app/components/community-lookbook-grid.tsx` and `apps/web/src/app/components/locations/location-format.ts`.
- Story 1.2b mobile owner: the Locations screen in `apps/mobile/src/features/locations/locations-screen.tsx` and `onLocationsChanged` in `apps/mobile/src/lib/locations.ts`.
- Story 1.2b mobile cache owner: ordered, generation-aware ritual cache writes in `apps/mobile/src/lib/ritual-cache.ts`.
- Story 1.2b harness owner: the deterministic geocoding and forecast double in `scripts/weather-provider-double.mjs`.
- Story 1.2b env owner: caller-owned env keys shared by load-env, migrate and Playwright in `scripts/lib/caller-owned-env.mjs`.

Tests that cover this step:

API unit tests:

- [`apps/api/src/modules/location-preferences/location-candidate-token.spec.ts`](../../apps/api/src/modules/location-preferences/location-candidate-token.spec.ts): proves signing, tamper and foreign-secret refusal, the literal 15-minute boundary, and the fail-closed secret rule.
- [`apps/api/src/modules/location-preferences/location-key.spec.ts`](../../apps/api/src/modules/location-preferences/location-key.spec.ts): proves Unicode folding, coordinate suffixes, and a long name shortened to the 120-character cap.
- [`apps/api/src/modules/location-preferences/location-capture.service.spec.ts`](../../apps/api/src/modules/location-preferences/location-capture.service.spec.ts): proves check order, the 3-second abort, invalid timezone and too-few-usable-days refusals, and every analytics outcome.
- [`apps/api/src/modules/location-preferences/location-preferences.service.spec.ts`](../../apps/api/src/modules/location-preferences/location-preferences.service.spec.ts): proves the stale-snapshot refresh on switch and on delete promotion.
- [`apps/api/src/modules/location-preferences/location-preferences.controller.spec.ts`](../../apps/api/src/modules/location-preferences/location-preferences.controller.spec.ts): proves the new routes, the required platform header and typed error mapping.
- [`apps/api/src/modules/location-preferences/location-preferences.module.spec.ts`](../../apps/api/src/modules/location-preferences/location-preferences.module.spec.ts): proves `WEATHER_PROVIDER_MODE` picks the matching geocoding client and forecast provider, and an unknown mode refuses to build.
- [`apps/api/src/modules/weather/providers/location-geocoding.spec.ts`](../../apps/api/src/modules/weather/providers/location-geocoding.spec.ts): proves both providers' normalization, ISO country resolution, and dropped unresolvable countries.
- [`apps/api/src/modules/weather/providers/weather-provider-origin.spec.ts`](../../apps/api/src/modules/weather/providers/weather-provider-origin.spec.ts): proves a production runtime, `VERCEL_ENV=production` included, refuses every origin override.
- [`apps/api/src/modules/weather/weather-refresh.queue.spec.ts`](../../apps/api/src/modules/weather/weather-refresh.queue.spec.ts): proves the lazy producer, the worker's retries and bucketed job id, the five-minute fallback bucket, and a single close on shutdown.
- [`apps/api/src/modules/weather/weather-processor.spec.ts`](../../apps/api/src/modules/weather/weather-processor.spec.ts): proves the bucketed location job id the sweep and the refresh queue share.
- [`apps/api/src/modules/telemetry/telemetry.location-events.spec.ts`](../../apps/api/src/modules/telemetry/telemetry.location-events.spec.ts): proves `location_switched` goes out under the HMAC subject with no properties and refuses place keys.
- [`apps/api/src/load-env.spec.ts`](../../apps/api/src/load-env.spec.ts): proves caller-owned database and Redis URLs survive the `.env.local` override.

Real-PostgreSQL API integration tests:

- [`apps/api/integration/location-capture.integration.spec.ts`](../../apps/api/integration/location-capture.integration.spec.ts): `1.2b-INT-01` to `INT-12` over real HTTP, covering first save with snapshot, the 3-second 503, same-name cities, no-region places, the fourth-location refusal, token tamper and expiry, replay for the caller only, a failed save forecast saving nothing, locale-independent keys, and the foreign-id 404.
- [`apps/api/integration/location-capture.lifecycle.integration.spec.ts`](../../apps/api/integration/location-capture.lifecycle.integration.spec.ts): `INT-11` and `INT-13` to `INT-21`, covering the legacy-primary refresh, the 31st-search 429, the missing-secret 503, analytics correlated to the member HMAC, the Maestro member reset, the INT-17 race barrier, six racing creates leaving three rows and one primary, exactly 30 of 35 parallel searches, the ritual reading the saved forecast, and erasure removing the search window.

Contract tests:

- [`packages/api-client/testing/locations-capture-contract.spec.ts`](../../packages/api-client/testing/locations-capture-contract.spec.ts): proves strict requests and additive-field-tolerant responses.
- [`packages/api-client/testing/analytics-events.spec.ts`](../../packages/api-client/testing/analytics-events.spec.ts): proves `location_switched` stays pseudonymous and the two new events normalize to closed property sets.
- [`pact/http/consumer/web-api-client.pacttest.ts`](../../pact/http/consumer/web-api-client.pacttest.ts) and [`pact/http/consumer/mobile-api-client.pacttest.ts`](../../pact/http/consumer/mobile-api-client.pacttest.ts): record search, from-search, list, primary and delete interactions from `pact/http/consumer/interactions/locations.ts`, verified against the real location services.

Web unit and component tests:

- [`apps/web/src/app/components/locations/locations-section.test.tsx`](../../apps/web/src/app/components/locations/locations-section.test.tsx): `1.2b-WEB-01` to `WEB-22`, covering the combobox keyboard path and wrap, the 300 ms debounce, the busy state and double-submit guard, a kept candidate on a save 503, the retried search announced once, axe, and focus moving to the delete confirmation.
- [`apps/web/src/app/components/locations/location-format.test.ts`](../../apps/web/src/app/components/locations/location-format.test.ts): proves the return path sends protocol-relative, backslash, encoded and absolute targets home, plus error key and place formatting.
- [`apps/web/src/lib/locations.test.ts`](../../apps/web/src/lib/locations.test.ts): proves transport error mapping, including an aborted search staying an abort.
- [`apps/web/src/app/components/community-lookbook-grid.test.tsx`](../../apps/web/src/app/components/community-lookbook-grid.test.tsx): `1.2b-WEB-GRID-01` and `02`, proving the add-location action shows only for `no_location` and leaves with its notice on sign-out.
- [`apps/web/src/app/settings/page.test.tsx`](../../apps/web/src/app/settings/page.test.tsx): `1.2b-WEB-SETTINGS-01`, proving the page title reads the member's locale.
- [`apps/web/src/i18n/locations-locales.spec.ts`](../../apps/web/src/i18n/locations-locales.spec.ts): proves location copy parity across ten web catalogs.

Mobile unit and screen tests:

- [`apps/mobile/src/features/locations/locations-screen.test.tsx`](../../apps/mobile/src/features/locations/locations-screen.test.tsx): `1.2b-MOB-01` to `MOB-11`, covering search, save, return to the origin, a kept city on a 503, the rate-limit copy, one-tap primary switch, rename, delete promotion, `aria-busy` on the web build, and 44-point targets.
- [`apps/mobile/src/lib/ritual-cache-ordering.test.ts`](../../apps/mobile/src/lib/ritual-cache-ordering.test.ts): `MOB-CACHE-01` to `06`, proving a held or rejected write cannot republish a forgotten primary.
- [`apps/mobile/src/screens/hero-no-location.test.tsx`](../../apps/mobile/src/screens/hero-no-location.test.tsx): `1.2b-MOB-HERO-01` and `02`, proving the guided action opens the Locations screen and a ritual appears after a save with no manual reload.
- [`apps/mobile/src/screens/tab-two-screen.test.tsx`](../../apps/mobile/src/screens/tab-two-screen.test.tsx): `1.2b-MOB-SETTINGS-01`, proving the Settings row opens Locations.
- [`apps/mobile/src/i18n/locations-locales.spec.ts`](../../apps/mobile/src/i18n/locations-locales.spec.ts): proves location copy parity across ten mobile catalogs.
- [`apps/mobile/src/screens/community-screen.test.tsx`](../../apps/mobile/src/screens/community-screen.test.tsx): runs `1.2b-MOB-COMMUNITY-01` to `03` from `apps/mobile/src/test-utils/community-screen/feed.cases.tsx`, proving the guided action, the band resolving on a mounted tab after a save elsewhere, and the notice leaving on sign-out.

Harness tests:

- [`playwright/support/helpers/caller-owned-env.spec.ts`](../../playwright/support/helpers/caller-owned-env.spec.ts): proves the runner, workers and launcher keep an isolated `DATABASE_URL` and `REDIS_URL`.
- [`playwright/support/helpers/expo-go-link-endpoint.spec.ts`](../../playwright/support/helpers/expo-go-link-endpoint.spec.ts), [`playwright/support/helpers/package-manager-readiness.spec.ts`](../../playwright/support/helpers/package-manager-readiness.spec.ts) and [`playwright/support/helpers/maestro-flow-outcome.spec.ts`](../../playwright/support/helpers/maestro-flow-outcome.spec.ts): prove the R24, R28 and R29 Maestro runner fixes.

Playwright end-to-end tests:

- [`playwright/tests/location-capture.spec.ts`](../../playwright/tests/location-capture.spec.ts): `1.2b-E2E-01` saves through the guided Community entry and proves a ritual on the persisted forecast, a resolved band and a stamped spotlight area; `E2E-02a` to `02f` cover same-name cities by keyboard, the limit, one-press primary switch, rename, delete promotion and axe.
  Tagged `@local-lane`, so the preview and production configs never run it.

Mobile end-to-end test:

- [`maestro/location-capture.yaml`](../../maestro/location-capture.yaml): the guided entry from the hero on a member with zero locations, proving the hero shows the per-run sentinel temperature and the runner's request-log check proves the forecast was fetched at the saved coordinates.

Evidence boundaries:

- **Source-comment follow-up.**
  36 of the 36 linked source files in this test map lack a Step 45 cross-link comment in the reviewed Git snapshot.
  This document-only review leaves those source comments for a repository change.

- **Local review artifacts.**
  The cited `story-*` review records are retained locally under `_bmad-output/test-artifacts/` and ignored by Git.
  A fresh checkout can use the tracked story spec as the portable account of those findings.

- **No numbers here were reproduced by this step's author.**
  The TEA scores (61/100 at `1d70b156`, 89/100 strict at `40a4cf79`) come from `cc12b-tea-test-review.md`.
  CI green at 30 of 30 checks on head `3916baaf` comes from `story-1-2b/implementation-checkpoint.md`.
  The 1 to 15 failures per full API run, the 0 of 80 onboarding launches and the 12 of 12 R30 runs come from the spec's Implementation Notes.
- **Location capture has no iOS Maestro CI lane.**
  iOS `location-capture.yaml` passed locally on an iPhone 17 simulator at `40a4cf79`, and its iOS-only keyboard guard was unrun on iOS at the time of the TEA review.
- **The double cannot prove the real providers behave like it.**
  No tier calls live OpenWeather or WeatherAPI geocoding, by design, so a provider changing its response shape is caught only in production.
- **Preview and production depended on a secret.**
  `LOCATION_CANDIDATE_SECRET` was recorded as an external prerequisite; until it is set, those deployments answer the fail-closed 503 on search and save.
  This step did not check whether it has been set.
- **No device location.**
  GPS, browser geolocation and a new OS permission were out of scope, so the PRD's approximate auto-detect remains unbuilt.
- **R28's root cause is unproven.**
  The `pm clear` stall in CI kept no device log; the readiness probe is a guard against the working hypothesis.
- **CodeRabbit did not review PR #159**, at 166 files.

Architecture diagram:

```mermaid
flowchart TD
  Guided["Add a location<br/>hero or Community no_location"] --> UI["Locations UI<br/>web settings or mobile screen"]
  UI -- "debounced 300 ms" --> Search["GET /locations/search"]
  Search --> Limit{"LocationSearchWindow<br/>30 per member per minute"}
  Limit -- "31st" --> R429["429 Retry-After"]
  Limit --> Geo["provider geocoding<br/>3 s timeout, ISO country"]
  Geo --> Cand["up to 5 candidates<br/>HMAC candidateToken, 15 min"]
  Cand --> UI
  UI -- "candidateToken + label" --> Save["POST /locations/from-search"]
  Save --> Verify{"token valid?"}
  Verify -- "no" --> R400["400 invalid_candidate"]
  Verify --> Key["buildSearchLocationKey<br/>folded name, region, country<br/>+ 3-decimal coordinates"]
  Key --> Pre{"duplicate or 3 saved?"}
  Pre -- "yes" --> R400b["400 duplicate or limit"]
  Pre --> Fc["one forecast call, 3 s<br/>valid IANA timezone<br/>band minimum usable days"]
  Fc -- "fails" --> R503["503 retryable<br/>nothing saved"]
  Fc --> Tx["one transaction<br/>SavedLocation + WeatherSnapshot"]
  Tx --> Ritual["ritual reads persisted forecast<br/>no test-env fallback"]
  Tx --> Band["climate band resolves"]
  Tx --> Area["next post stamped with spotlight area"]
  Switch["switch primary or delete promotion"] --> Stale{"snapshot missing<br/>or older than 5 min?"}
  Stale -- "yes" --> Queue["weather-refresh-location<br/>bounded 1 s enqueue"]
```

## Step 46: Home spotlight teaser

User/business impact:

Step 44 put the City Spotlight inside Community, so a member only met standout local looks after leaving Home.
This step puts the viewer's rank-1 spotlight entry on Home: a small card with the area label, the look's image, the author and its reaction count.
It shows on mobile Home and on stacked web layouts, below the hero.
Tapping it opens Community and puts focus on that same entry in the City Spotlight, with one screen-reader announcement.

The teaser shows something real or nothing.
Empty, `none`, disabled, age-gated, rate-limited, failed, expired, or a broken image all render nothing and take no space.
It reads on its own, so a slow or failing teaser never touches the hero, the chips, the garments or the planner.

The epic's AC3 asked for a sponsored "Shop this look" button on the teaser.
No community post could carry a sponsorship yet, so the owner moved it to Story 6.7b on 2026-10-23, in the first commit of this PR.
Step 47 covers it.

Key takeaways:

1. **Reuse the read and tag the caller.**
   The teaser calls Step 44's page-one spotlight read with `limit=1` and a new optional `surface=home_teaser`.
   Ranking, level, cohort, cursor and cache stay as they were.
   `surface` only changes analytics: `community_spotlight_viewed` and `community_spotlight_opened` gain a required `surface`, and both dedupe keys carry it.
2. **One lifecycle object for two clients.**
   `SpotlightTeaserState` in `@couture/api-client` owns every timing rule: re-read 4 minutes after the last attempt, expire 5 minutes after the read completed, at most one read per 60 seconds, and wait out a 429 `Retry-After`.
   Web and mobile only feed it their own signals: identity, focus, foreground, visibility and layout.
   The rules live and get tested in one place.
3. **A value belongs to one member.**
   An identity change clears the value, aborts the read in flight, drops any late answer and resets the floor and the deferral, so the next member reads at once.
   A success that cannot render (`none`, no items) still schedules the timed re-read.
   A failure schedules nothing, and the next focus or foreground reads again.
4. **Render nothing means no placeholder.**
   AC2 says Home with an invalid teaser must look exactly like Home without one.
   The tests compare against a structural reference: the mobile scroll content ends with the hero node, and the web hero canvas holds nothing after the hero.
5. **Carry focus across screens as a one-time token.**
   Each tap mints a fresh `focusToken`.
   Mobile pushes `/community` with `{ source: 'app', type: 'community', cardId, focus: 'spotlight', focusToken }`, which `packages/utils/src/deep-link.ts` now accepts.
   Community copies the intent into state before it clears the params, and the outcome consumes it.
   A repeated token, a later identity change or a module that recovers later moves no focus.
6. **Every destination outcome lands focus somewhere.**
   The entry present gets focus and `community.feed.announceFocused`.
   A settled module without the entry focuses `community.spotlight.targetUnavailable`.
   A missing module, or one still loading after 10 seconds, focuses `community.spotlight.destinationUnavailable`.
   The notice sits above every availability gate, so it can render when Community itself cannot.
7. **The web teaser exists only while the layout stacks.**
   Stacked means `isMobilePreview || window.innerWidth < 1280`, measured after mount.
   Side-by-side layouts issue no `home_teaser` read at all.
   The value lives in layout-level state, so a resize that unmounts and remounts the teaser keeps it and follows the same 60-second rule.
8. **Screen-reader focus on native needs native code.**
   React Native 0.81 reports no accessibility focus and cannot reliably move TalkBack's cursor.
   `apps/mobile/modules/accessibility-focus` is a local Expo module that reports OS focus changes and moves focus itself.
   Story 6.8's share card later reused it: `ShareCardComposerTalkBackTest.kt` sits beside the teaser's own TalkBack test.

Hard-won lessons from the implementation and code review of this story:

1. **The mobile teaser first read for the wrong member.**
   Keyed on the verified application user alone, it had no member in any build that holds a bearer without a verified native session, which is exactly how the Maestro harness runs.
   The first local Android run found no teaser.
   It now resolves the member the Community screen reads for, `communityCommentsSessionFromMobile`.
2. **An `aria-label` on the link failed axe.**
   The first local Playwright run reported `label-content-name-mismatch` (WCAG 2.5.3), because the visible text and the accessible name disagreed.
   The link label is now screen-reader text inside the link, and the visible lines are `aria-hidden`.
3. **The accent gold measured about 2.3:1 on white** in the first iOS screenshot, under the AA floor for 13 pt text.
   The mobile CTA uses `#8A691F` on light surfaces and `#C9A14A` on dark.
4. **`Pressable` focus events never fire for VoiceOver or TalkBack.**
   The first build tracked teaser focus through `onFocus`/`onBlur`, and the round 1 fix for that (R2) used a 10-second window after a return focus.
   Round 2 (R13) removed the timer: the teaser hands focus to the scroll view on removal only while the OS reports focus on it.
   The evidence behind that decision is in the spec: Android's `setAccessibilityFocus` is a no-op that sends `TYPE_VIEW_FOCUSED`, which TalkBack ignores for the link.
5. **The device run found three more native facts.**
   Home's views reattach a frame after navigation reports focus, so a refused move retries for up to `NATIVE_FOCUS_FRAMES` (60).
   TalkBack reports focus from inside the native call, before its promise resolves, so a request listens from the moment it is sent.
   TalkBack refuses `ACTION_ACCESSIBILITY_FOCUS` on a view it already holds and sends no event, so `moveFocus` counts a held view as moved.
6. **A device check that reads your own bookkeeping proves nothing.**
   Home renders two markers per return: `focus-requested` once a request reached a real node, and `focused` only after the platform confirmed it (R12).
   With the platform focus call suppressed, the request marker still renders and the TalkBack flows fail, as they must.
   The CI lane holds the same line: its suppressed-focus control must fail exactly the four tests that need the OS report (R27).
7. **A symbol check can pass on a binary that lacks the symbol.**
   The iOS release check grepped the plain name `AccessibilityFocusModule`, which a Swift binary does not carry and a stripped binary drops (R30).
   It now reads the runtime class name `_TtC18AccessibilityFocus24AccessibilityFocusModule` from the binary's strings, with a red control built without the module.
8. **A deadline kept counting in the background.**
   The 15-second image timeout ran while the app was backgrounded, so a teaser read just before leaving was removed on return, and the 60-second floor then kept it away.
   The deadline now runs only while Home is focused and foregrounded (6.7-MOB-054).
9. **The first test suite scored 52 of 100.**
   `reviews/cc67-tea-test-review.md` named each gap by the one-line production break that stayed green.
   Deleting the re-arm on a quick return left everything green, and so did dropping the timed re-read after a non-renderable success.
   AC2's "no space" check compared against a snapshot taken while the first read was pending, itself a no-teaser state, so a placeholder `View` passed.
   A Maestro fallback flow waited 305 seconds on an id that never exists, marked optional, which is a sleep that cannot fail and cost about seven minutes of device time per run; it was deleted.
   The review reports 96 after remediation, each fix with a red proof.
10. **A raw `npx playwright test` reset the default database (R16).**
    On 2026-10-23 at 21:52:56Z a validation run without the isolated database env reached global teardown, which ran `npm run db:reset` against 127.0.0.1:54322.
    The reset ran for every local run that did not opt out, and the env loader supplies a local `DATABASE_URL` on its own.
    Reset is now opt-in: `npm run test:pw-local` alone sets `PLAYWRIGHT_DB_RESET=true`.
    The first version of the policy spec called the real teardown, which stopped the burn-in web server it ran inside (R17, R21); it now mocks the stack stopper.
11. **A 100 ms pool wait became a silent 503 (R37).**
    k6 smoke saw the band-filtered feed answer "Access could not be verified" while the unfiltered read passed.
    Story 6.5's authorization gate capped Prisma's `maxWait` at 100 ms, so a request queued for a pooled connection got P2028, and `communityDependency` turned it into a 503 without logging it.
    The gate now waits up to the remaining 1950 ms budget and logs the cause.
    `community-gate-pool-wait.integration.spec.ts` holds the only connection of a one-connection pool for 300 ms to prove it.
12. **The teaser PR carried seventy findings, most of them elsewhere.**
    `reviews/code-triage-1.md` runs R1 to R70.
    Many rows are harness, device or neighbouring-story defects: wardrobe signing that failed a whole list for one image (R38), Story 6.4 comment drafts lost on an availability flip (R46 to R49, with R49 reversed to keep 6.4's contract), modal sheets that left the tab bar undimmed (R52, R57), Story 6.5's real-session specs that had never run in CI (R50), Maestro driver reuse (R62, R68), and a CI tap that landed on Gboard's G key after the keyboard lifted (R70).
    Each row closed with a test and evidence, and review rounds ran to 17.

Story/Task mapping:

- Story 6.7
- Task 1 (record the 6.7b split in `epics.md`, `sprint-status.yaml` and `epic-6-context.md`)
- Task 2 (`surface` query and opened branch, `surface` event property and dedupe, regenerated OpenAPI and SDK)
- Task 3 (`app` deep-link source with the focus intent)
- Task 4 (mobile teaser, Home placement, Community focus intent, notices and return focus)
- Task 5 (web teaser in the hero canvas for stacked layouts, in-page focus and notices)
- Task 6 (copy keys in all 20 locale catalogs)
- Task 7 (unit, integration, Pact, Playwright and Maestro coverage)

Story reference:

- `_bmad-output/implementation-artifacts/spec-6-7-home-spotlight-teaser.md`, whose Implementation Notes record every review round and decision.
- `_bmad-output/test-artifacts/story-6-7/reviews/code-triage-1.md` for R1 to R70, the declined Astra 5 F4 decision record and the closing note.
- `_bmad-output/test-artifacts/story-6-7/reviews/cc67-tea-test-review.md` for the matrix coverage table and the red proofs.

Cross-links:

- Step 44 owns the spotlight ranking, cohort, read model and the Community module this teaser links into.
- Step 45 gives the member the saved area the spotlight ranks for; without one the teaser has nothing to show.
- Step 47 adds the sponsored Partnered row and CTA to this teaser.
- Step 43 (Story 6.5 realtime engagement, PR #157) owns the authorization gate R37 repaired.
- Step 42 (Story 6.4 comments, PR #154) owns the draft contract R49 restored.
- Step 27 provides the deep-link schema the focus intent extends.
- Step 28 provides the keyboard, focus and assistive-technology baseline.
- Step 25 provides the Lookbook Prism layout whose 1280 px split decides stacking.
- Step 22 provides locale parity across the ten web and mobile catalogs.
- Step 8 provides the strict analytics registry that `surface` extends.

Sequence to follow:

1. `packages/api-client/src/contracts/http/community.ts` for `communitySpotlightSurfaceSchema` and `communitySpotlightOpenSurfaceSchema`, then `packages/api-client/src/types/analytics-events.ts` for the `surface` property.
2. `apps/api/src/modules/community/community-spotlight.service.ts` and `community-analytics.ts` for the surface default and the dedupe keys.
3. `packages/api-client/src/community-spotlight-teaser-state.ts`, the whole lifecycle in 240 lines.
4. `packages/utils/src/deep-link.ts` for the focus intent and its refinement.
5. `apps/mobile/src/features/home/use-home-spotlight-teaser.ts` and `apps/mobile/components/home/home-spotlight-teaser.tsx` for the mobile binding, the memoized slot, the image deadline and the focus markers.
6. `apps/mobile/src/features/community/community-screen.tsx` for intent copy, outcome resolution and the notice above the gates, with `apps/mobile/components/info-banner.tsx` for the ref and the live-region switch.
7. `apps/mobile/modules/accessibility-focus/` and `apps/mobile/src/lib/accessibility-focus.ts` for the native focus report and move.
8. `apps/web/src/app/components/home-spotlight-teaser.tsx` and `lookbook-prism-layout.tsx` for the stacked gate and layout-level state, then `community-lookbook-grid.tsx` for `community-spotlight-notice`.

Task owner map:

- Story 6.7 contract owner: the `surface` query, the `home_teaser` opened branch and the required event `surface` in `packages/api-client/src/contracts/http/community.ts` and `packages/api-client/src/types/analytics-events.ts`.
- Story 6.7 API owner: default `surface` to `community` and key both dedupes by surface in `apps/api/src/modules/community/community-spotlight.service.ts` and `apps/api/src/modules/community/community-analytics.ts`.
- Story 6.7 lifecycle owner: the member-scoped read, re-read, expiry, floor and deferral in `packages/api-client/src/community-spotlight-teaser-state.ts`.
- Story 6.7 deep-link owner: the `app` source with `focus` and `focusToken` in `packages/utils/src/deep-link.ts` and `apps/mobile/src/lib/mobile-deep-link-handler.ts`.
- Story 6.7 mobile binding owner: identity, focus, foreground, the one-attempt read and return focus in `apps/mobile/src/features/home/use-home-spotlight-teaser.ts`.
- Story 6.7 mobile teaser owner: the card, the memoized slot and the absolutely positioned focus markers in `apps/mobile/components/home/home-spotlight-teaser.tsx`.
- Story 6.7 mobile destination owner: intent copy, outcomes and the focused notice in `apps/mobile/src/features/community/community-screen.tsx`, with handled-request retirement in `apps/mobile/src/features/community/use-community-spotlight.ts`.
- Story 6.7 native focus owner: OS focus report and move in `apps/mobile/modules/accessibility-focus/index.native.ts`, its Android sources under `apps/mobile/modules/accessibility-focus/android/` and iOS sources under `apps/mobile/modules/accessibility-focus/ios/`.
- Story 6.7 web teaser owner: the teaser and its layout-level lifecycle in `apps/web/src/app/components/home-spotlight-teaser.tsx`, mounted by `apps/web/src/app/components/lookbook-prism-layout.tsx`.
- Story 6.7 device evidence owner: the local TalkBack runner `scripts/run-story67-talkback.mjs` with `maestro/story67/`, and the CI lane `.github/workflows/pr-accessibility-focus.yml` with `scripts/ci/accessibility-focus-device-tests.sh`.

Tests that cover this step:

Each file below should start with a Step 46 cross-link comment.
Test ID counts are counted from the repository at `185e827c`.
Pass results and durations are reported by the story's own runs; see `Evidence boundaries`.

Shared lifecycle and contract unit tests:

- [`packages/api-client/testing/community-spotlight-teaser-state.spec.ts`](../../packages/api-client/testing/community-spotlight-teaser-state.spec.ts): proves every timing rule under a controlled clock, with boundaries at 239,999 and 240,000 ms, member resets, a non-renderable success that still re-reads, and `Retry-After` handling (24 IDs between 6.7-UNIT-020 and 043).
- [`packages/api-client/testing/community-analytics.spec.ts`](../../packages/api-client/testing/community-analytics.spec.ts): 6.7-CON-001 requires a known `surface` on both spotlight events.
- [`packages/api-client/testing/community-publication-contract.spec.ts`](../../packages/api-client/testing/community-publication-contract.spec.ts): 6.7-CON-002 and 003 accept the teaser open under the same rank and level rules and default the read surface to `community`.
- [`packages/utils/src/deep-link.spec.ts`](../../packages/utils/src/deep-link.spec.ts): 6.7-UNIT-010 and 011 parse the focus intent and refuse one missing its card, token or `app` source.

API unit tests:

- [`apps/api/src/modules/community/community-spotlight.controller.spec.ts`](../../apps/api/src/modules/community/community-spotlight.controller.spec.ts): 6.7-UNIT-001 and 002 pass `home_teaser` through, refuse unknown surfaces and route a teaser open with its surface.

Real-PostgreSQL integration tests:

- [`apps/api/integration/community-spotlight-http.integration.spec.ts`](../../apps/api/integration/community-spotlight-http.integration.spec.ts): 6.7-HTTP-001 to 003, split by concern after the test review: a `home_teaser` read serves rank 1 with its own view dedupe, teaser and legacy opens report their surfaces with no raw identifier, and an unknown surface is refused and records nothing.

Web component tests:

- [`apps/web/src/app/components/home-spotlight-teaser.test.tsx`](../../apps/web/src/app/components/home-spotlight-teaser.test.tsx): the matrix rows in the Lookbook Prism layout, the 1279 and 1280 px boundary, one announcement counted on the live region, both notices, focus left alone when another control holds it.
- [`apps/web/src/app/components/home-spotlight-teaser.timers.test.tsx`](../../apps/web/src/app/components/home-spotlight-teaser.timers.test.tsx): re-read, expiry and the 10-second deadline under a fake clock; split out of the first file by Story 6.7b to keep both under 1000 lines.

Mobile unit and screen tests:

- [`apps/mobile/src/screens/home-spotlight-teaser.test.tsx`](../../apps/mobile/src/screens/home-spotlight-teaser.test.tsx): the matrix rows on Home, hero states, the structural no-space check, the focus markers measured to take no layout (6.7-MOB-010, 011), the 15-second image deadline and its background pause (6.7-MOB-054); 23 IDs.
- [`apps/mobile/src/screens/home-spotlight-teaser-native.test.tsx`](../../apps/mobile/src/screens/home-spotlight-teaser-native.test.tsx): native focus handles with exact call counts, OS-reported focus handoff, frame retries (6.7-MOB-048, 049), and a hero render counter that stays flat through teaser updates (6.7-MOB-035); 11 IDs.
- [`apps/mobile/src/screens/community-screen.test.tsx`](../../apps/mobile/src/screens/community-screen.test.tsx): runs `spotlight-focus.cases.tsx`, the destination outcomes, intent retirement on blur, no replay after recovery, and no focus move after an identity change.
- [`apps/mobile/components/info-banner.test.tsx`](../../apps/mobile/components/info-banner.test.tsx): the forwarded ref, the live region off and one mounted instance across messages.
- [`apps/mobile/src/lib/accessibility-focus-module.test.ts`](../../apps/mobile/src/lib/accessibility-focus-module.test.ts): the native wrapper reads the module on each call, faked at `expo-modules-core`.
- [`apps/mobile/src/lib/mobile-deep-link-handler.test.ts`](../../apps/mobile/src/lib/mobile-deep-link-handler.test.ts): 6.7-MOB-037 and 038 keep a tokened focus intent and refuse one without its token.
- [`apps/mobile/src/i18n/home-spotlight-teaser-locales.spec.ts`](../../apps/mobile/src/i18n/home-spotlight-teaser-locales.spec.ts): every new key, placeholder and plural form in all ten mobile and web catalogs.

Native module tests:

- [`apps/mobile/modules/accessibility-focus/android/src/test/java/expo/modules/accessibilityfocus/AccessibilityFocusObserverTest.kt`](../../apps/mobile/modules/accessibility-focus/android/src/test/java/expo/modules/accessibilityfocus/AccessibilityFocusObserverTest.kt): Robolectric cases for delegate forwarding and restore, the API 29 gate, and attach without an Activity.
- [`apps/mobile/modules/accessibility-focus/android/src/androidTest/java/expo/modules/accessibilityfocus/AccessibilityFocusTalkBackTest.kt`](../../apps/mobile/modules/accessibility-focus/android/src/androidTest/java/expo/modules/accessibilityfocus/AccessibilityFocusTalkBackTest.kt): runs on an API 35 emulator with TalkBack on, then again with focus suppressed as a control that must fail.
- [`apps/mobile/modules/accessibility-focus/ios/Tests/AccessibilityFocusTargetTests/AccessibilityFocusTargetTests.swift`](../../apps/mobile/modules/accessibility-focus/ios/Tests/AccessibilityFocusTargetTests/AccessibilityFocusTargetTests.swift): refuses a view outside a window or under a hidden ancestor.
- [`playwright/support/helpers/accessibility-focus-results.spec.ts`](../../playwright/support/helpers/accessibility-focus-results.spec.ts) and [`playwright/support/helpers/accessibility-focus-workflow.spec.ts`](../../playwright/support/helpers/accessibility-focus-workflow.spec.ts): the lane's JUnit verdict rule and its path filters.

Pact contract tests:

- [`pact/http/consumer/interactions/community/spotlight.ts`](../../pact/http/consumer/interactions/community/spotlight.ts): the `home_teaser` read with a level matched to city, region or country, the teaser open, and a 429 carrying `Retry-After`, recorded by [`pact/http/consumer/web-api-client.pacttest.ts`](../../pact/http/consumer/web-api-client.pacttest.ts) and [`pact/http/consumer/mobile-api-client.pacttest.ts`](../../pact/http/consumer/mobile-api-client.pacttest.ts) and verified by [`pact/http/provider/api-provider.pacttest.ts`](../../pact/http/provider/api-provider.pacttest.ts).

Playwright end-to-end test:

- [`playwright/tests/home-spotlight-teaser.spec.ts`](../../playwright/tests/home-spotlight-teaser.spec.ts): a narrow layout shows the seeded rank-1 entry with its stored alias, passes axe and focuses the entry from the keyboard; a wide layout issues no `home_teaser` read; a viewer with no spotlight gets no teaser and no space.

Mobile end-to-end tests:

- [`maestro/home-spotlight-teaser.yaml`](../../maestro/home-spotlight-teaser.yaml): the teaser after the hero on the shared Chicago cohort, activation into the City Spotlight, and the Home tab and Android back returns through the `focus-requested` marker.
- `maestro/story67/`, driven by `scripts/run-story67-talkback.mjs` on a local Android development build with TalkBack: Android back lands OS focus on the link, and a sign-out fallback lands it on the scroll view.

Harness guards added on the same PR:

- [`playwright/support/helpers/db-reset-policy.spec.ts`](../../playwright/support/helpers/db-reset-policy.spec.ts): the opt-in reset table and the teardown with the stack stopper mocked (R16, R21).
- [`apps/api/integration/community-gate-pool-wait.integration.spec.ts`](../../apps/api/integration/community-gate-pool-wait.integration.spec.ts): the gate waits for a held pool connection and still answers 503 when the budget runs out (R37, R41).
- [`apps/api/integration/playwright-advisory-lock.integration.spec.ts`](../../apps/api/integration/playwright-advisory-lock.integration.spec.ts): three worker processes never hold the feed lock at once, a dead holder frees it, and a wait ends with `lock_not_available` (R32, R35, R36).

Evidence boundaries:

- **Source-comment follow-up.**
  29 of the 29 linked source files in this test map lack a Step 46 cross-link comment in the reviewed Git snapshot.
  This document-only review leaves those source comments for a repository change.

- **Local review artifacts.**
  The cited `story-*` review records are retained locally under `_bmad-output/test-artifacts/` and ignored by Git.
  A fresh checkout can use the tracked story spec as the portable account of those findings.

- **iOS VoiceOver was never observed on a device.**
  The Simulator has no VoiceOver, so iOS return focus is covered at unit level and by the XCTest target.
- **The app-level TalkBack journey is local evidence.**
  CI runs the module against TalkBack on an API 35 emulator; the full Home return and fallback under TalkBack ran only through `scripts/run-story67-talkback.mjs` (`runs/r7f-talkback-return`, `runs/r7f-talkback-fallback`, with both suppressed controls red).
  Astra 5 F4 asked for it in CI and was declined on 2026-10-23: the job would need the development build, the API, Supabase, an OTP proxy and Metro on the runner.
- **Every pass result here is reported.**
  The 52 to 96 test-review score comes from `reviews/cc67-tea-test-review.md`.
  The nine Robolectric tests, the green final CI of all 12 workflows at `c7a78c67` and the final device runs come from `reviews/code-triage-1.md`.
  This step's writer ran no suite.
- **The Maestro duration is a local estimate.**
  `scripts/maestro-flow-durations.json` records 126 seconds from the first local Android run and says to replace it with a CI figure.
- **No tier measures whether the teaser brings anyone to the spotlight.**
  The tests prove `community_spotlight_opened` carries `surface: home_teaser`; what members do with it is unmeasured.
  The story enabled no rollout flag.

Architecture diagram:

```mermaid
flowchart TD
  subgraph Clients["Web stacked layout or mobile Home"]
    SIG["identity, focus, foreground,\nvisibility, layout stacked"] --> STATE["SpotlightTeaserState\nre-read 4 min after attempt\nexpire 5 min after read\n60 s floor, Retry-After"]
    STATE -- "one attempt, limit=1" --> READ["GET spotlight\nsurface=home_teaser"]
    READ --> RULE{"level not none\nand one item?"}
    RULE -- "yes" --> CARD["teaser after the hero\nlabel, image, author, count"]
    RULE -- "no, error, expiry,\nimage failure" --> NOTHING["render nothing\nreserve no space"]
  end

  READ --> API["Step 44 ranking and cache\nunchanged"]
  API --> VIEW["community_spotlight_viewed\nsurface in dedupe key"]

  CARD -- "tap: fresh focusToken" --> OPEN["POST opened\nsurface home_teaser, rank, level"]
  CARD -- "tap" --> NAV["Community with\napp source, cardId,\nfocus spotlight, focusToken"]
  NAV --> COPY["copy intent to state\nthen clear params"]
  COPY --> OUT{"destination outcome"}
  OUT -- "entry present" --> FOCUS["focus entry\nannounce once"]
  OUT -- "module settled\nwithout entry" --> TN["focus targetUnavailable notice"]
  OUT -- "module absent or\nloading after 10 s" --> DN["focus destinationUnavailable notice"]

  FOCUS --> BACK["back or Home tab press"]
  TN --> BACK
  DN --> BACK
  BACK --> RET{"teaser still rendered?"}
  RET -- "yes" --> LINK["focus teaser link"]
  RET -- "no" --> SCROLL["focus Home scroll view"]
  LINK -.-> NATIVE["native build:\naccessibility-focus module\nmoves and confirms OS focus"]
  SCROLL -.-> NATIVE
```

## Step 47: Sponsored community highlights

User/business impact:

A standout community look can now be shopped.
When the owner links a post to a garment affiliate offer, every opted-in reader who sees that post on the feed, in the City Spotlight, in the detail view or on the Home teaser gets a "Partnered" disclosure and a separate "Shop this look" button, on web and mobile.
Tapping it mints an attributed click through the Story 5.1 click flow from Step 33, with three new community surfaces, and opens the partner site.

Only the owner can create or end a sponsorship, through `npm run community:sponsorship`, an audited command with no HTTP route.
Only an adult author's post with a recorded author agreement can carry one, and only a garment offer can back it.
Production stays dark: `commerce_affiliate_enabled` and both community rollout flags still default to false.

Key takeaways:

1. **Project per-viewer commerce after the cache.**
   The block is attached in `CommunityController` after the community read and after the spotlight's Redis read model, which keeps post ids only.
   Linking or ending a sponsorship applies on the next read with no cache action, which is the Step 33 rule (commerce assembled after personalization) applied to a second surface.
2. **Make a new response field opt-in per request.**
   Installed clients parse strict schemas, so only a request carrying `x-couture-sponsorship: 1` gets the sponsored variants, and `Vary` names the header in the middleware and on every route.
   The sponsored variants extend the Story 6.3 reaction variants, so one schema per route serves requests with or without `x-couture-reactions`.
3. **One eligibility rule, used by the read and by the click.**
   `CommerceRepository.findEligibleCommunitySponsorships` checks the link window, the offer, the partner, the region and public visibility in one batched statement per page, with `now() AT TIME ZONE 'UTC'` from Step 33's time zone lesson.
   The click re-check calls the same query narrowed to one offer, with the same region inputs, so a read and the tap that follows agree.
4. **The surface picks the rule; server data decides the outcome.**
   A community click runs the full sponsorship re-check before the 60-second dedupe lookup and before the garment or advisor branch.
   A link that ended between read and tap, or ended inside the dedupe minute, answers 404 with no redirect and no row.
5. **Keep commercial identity out of analytics with a keyed union.**
   `affiliate_cta_shown` and `affiliate_cta_clicked` are discriminated unions on `surface`.
   The community member is strict, carries `partnerId`, `offerId`, `surface` and `localeRegion` only, and rejects `scenario`, `recommendationId` and any post, author or user identifier.
6. **Close every personal-data door in a record that outlives erasure.**
   Audit rows survive post erasure, so the agreement reference must match `^agr_[0-9A-HJKMNP-TV-Z]{26}$` and both reasons are closed codes enforced by CHECK constraints, leaving no field that can hold a name or an email.
7. **An operator command needs its own targeting rules.**
   `--env-file` is the only source of `DATABASE_URL`, and any non-loopback host also needs `--confirm-target` equal to the project ref parsed from the URL.
   The actor must be `admin` in `auth.users.raw_app_meta_data` and map to the same app `User`, and link plus audit row commit in one transaction.
8. **Order live answers by when the read started.**
   Both clients keep a per-viewer `LiveSponsorshipLedger`: each live read takes a stamp from `begin()`, and an answer from a read that started earlier than the recorded one is dropped whatever order responses land in.
   Realtime `targets/resolve` copies carry no block, so they take the ledger's latest live answer.

Hard-won lessons from the implementation and code review of this story:

1. **The first spec let an advisor offer and a post id fall through the old click branches.**
   The story review found that a community click keyed on the client surface would reach the Decision 7 advisor branch for an advisor offer, store `recommendation_id = 'unresolved'` and `scenario = 'unknown'` for a garment offer, and redirect a replay of an ended link from the dedupe lookup.
   The fix ordered the community re-check first, added `COMMUNITY_SCENARIO`, and limited sponsorship to garment offers (`cc67b-opus-story-review.md` finding 1).
2. **A syntax rule cannot refuse a name.**
   Rereview 2 showed `AlexTaylor` and `Alex_Taylor` both matched the proposed agreement pattern `^[A-Za-z0-9][A-Za-z0-9_-]{5,63}$`, and free-text reasons could carry contact details into audit rows erasure keeps.
   The `agr_` ULID format and closed reason codes came out of that finding (`cc67b-astra-story-rereview-2.md`).
3. **Feed and spotlight resolved the viewer's region from different inputs.**
   The spotlight route read no `accept-language`, so a viewer with no saved locale would see a region-specific offer on the feed card and miss it on the spotlight and teaser.
   The spotlight and post routes now pass `accept-language`, and `6.7b-INT-212` pins the agreement across all three surfaces.
4. **With `noopener`, `window.open` always returns null.**
   The web open helper read that null as failure and reported every successful handoff as an error, and the Story 5.4 palette advisor CTA from Step 36 had the same bug.
   Code review round 1 then found that opening after the mint await lets popup blockers kill the tab silently (R1).
   `beginAffiliatePartnerHandoff()` now claims a blank tab inside the click, nulls `tab.opener` at once, and navigates through an `<a rel="noreferrer">` after the mint; a failed mint closes it, and both CTAs use it.
5. **The realtime catch-up stripped the block on both clients.**
   `targets/resolve` carries no sponsorship, so a resolve copy replaced the live card and the Partnered CTA vanished on device; later the web "Show new looks" reveal did the same (R11).
   A stale block also survived a live rebuild that dropped it (R2), and an older read landing late could restore a block a newer read removed (R9, R12, R13).
   The ledger exists because each fix exposed the next ordering gap, and every consumer on both clients now writes items through it inside its state update.
6. **Header and parser must agree everywhere a response is parsed.**
   CI burn-in failed 27 times (9 tests, 3 repeats) with `unrecognized_keys sponsorship`, because two Playwright helpers strictly parsed the browser's opted-in feed responses with the reactions-only schema (R7).
   The local run had been chosen by surface, so the specs that parse feed responses were never in it; the full community set then ran at 59 passed (`runs/pw-community-full-1`, reported).
7. **A shown event needs a defined visit.**
   Mobile double-counted impressions on refocus and counted an app foreground return as a new Home visit (R3).
   A visit now starts when the screen gains navigation focus and ends when it loses it, and the in-app browser round trip does not start a new one.
8. **`supertest` on a bare Nest server can reach another process.**
   `request(app.getHttpServer())` binds a dual-stack wildcard port, and on macOS that port can belong to a process listening on `127.0.0.1`, which then answers the request; the triage measured 14 of 20,000 binds landing on such ports and one answering a POST with 401.
   Every API spec now binds `127.0.0.1` through `apps/api/src/testing/loopback-http-app.ts`, and a lint rule rejects `getHttpServer()` in API tests.
9. **Twelve review rounds went into a build lock that was then deleted.**
   Package builds ran `rm -rf dist` before `tsc`, so a concurrent reader failed to resolve `@couture/utils`.
   Private staging fixed that, then a per-package lock grew a heartbeat, `proper-lockfile`, terminal settlement and takeover rebuilds across R23 to R34, until serial CI builds failed on the lock misreading its own stamp.
   Decision D5 removed the lock: each build compiles into private `mkdtemp` staging, fails closed without touching `dist`, and publishes new then changed files in import order, so the last of two concurrent builds leaves a complete tree (`code-triage-1.md`, `deferred-work.md`).
10. **Long Maestro flows are timeout flakes waiting to happen.**
    `community-feed.yaml` grew from 205 s to 291 s against the 360 s per-flow cap across this story.
    It was split by concern into `community-feed.yaml` and `community-reactions.yaml` with every assertion kept, and the next CI run recorded 152 s and 109 s (R15, reported).
    The same sweep found a 119 s Android launch stall caused by Maestro pulling Expo Go's 186 MB APK to read permission names, now read once from `dumpsys` by the runner (R18).

Story/Task mapping:

- Story 6.7b, the ten execution items in the spec's `Tasks & Acceptance` list:
- Schema, migration and RLS: `CommunityPostSponsorship` with its window, reason and end-state CHECKs and the partial unique index on open links.
- Operator service, `scripts/community-sponsorship.ts`, package script and README section.
- Commerce repository and `CommunitySponsorshipService`: one batched eligibility query per page.
- Contracts, OpenAPI, SDK and analytics registry: opt-in variants, the block, three surfaces, keyed unions.
- Community feed, post and spotlight routes with `Vary`.
- Click service and telemetry: the community branch and its re-check.
- Web and mobile clients: header, parsers, CTA on card, spotlight, detail and teaser, shown events.
- Locales: ten per client.
- Seeds, cleanup order and the E2E flow-state reset.
- Tests at every tier listed below.

Story reference:

- `_bmad-output/implementation-artifacts/spec-6-7b-sponsored-community-highlights.md`, status `done`, with its Spec Change Log and Review Triage Log for the four story review rounds.
- `_bmad-output/test-artifacts/story-6-7b/reviews/code-triage-1.md`, findings R1 to R34 and decisions D1 to D5 with their red and green evidence.
- `_bmad-output/test-artifacts/story-6-7b/reviews/cc67b-tea-test-review.md`, the test-architecture review and its two remediation phases.
- `_bmad-output/implementation-artifacts/5-1-affiliate-shop-this-look-cta.md` for the click flow, Decision 1 on viewer age and Decision 7 on the advisor branch.

Cross-links:

- Step 33 provides the affiliate partner, offer, preference and click model, the opaque click token, the UTC window comparison and the post-cache assembly rule this step extends to community surfaces.
- Step 36 provides the palette advisor CTA whose web open helper this story fixed.
- Step 8 provides the analytics registry that now carries surface-keyed unions.
- Step 38 provides the community tables, the public visibility predicate and the API-only RLS posture the new table copies.
- Step 41 (Story 6.3 reactions, PR #153) provides the per-request opt-in header precedent and the reaction variants the sponsored schemas extend.
- Step 43 (Story 6.5 realtime engagement, PR #157) provides `targets/resolve`, the catch-up path that dropped the block until the ledger.
- Step 44 provides the City Spotlight read model the block is projected after, and Step 46 provides the Home teaser that now carries the CTA.

Sequence to follow:

1. `packages/db/prisma/migrations/20261024120000_community_post_sponsorship/migration.sql` for the table, its CHECKs, the partial unique index and the zero-grant RLS block.
2. `apps/api/src/modules/commerce/community-sponsorship.cli.ts` and `community-sponsorship-operator.service.ts` for targeting, actor resolution, every refusal and the single transaction.
3. `apps/api/src/modules/commerce/commerce.repository.ts` `findEligibleCommunitySponsorships`, then `community-sponsorship.service.ts` for the flag, preference and region chain and its fail-closed catch.
4. `apps/api/src/modules/community/community.controller.ts` `attachSponsorships` and the three header branches.
5. `apps/api/src/modules/commerce/affiliate-click.service.ts` `recordClick` and `recordCommunityClick` for branch order.
6. `packages/api-client/src/contracts/http/community.ts` (`COMMUNITY_SPONSORSHIP_HEADER` and the sponsored variants) and `packages/api-client/src/types/analytics-events.ts` (the keyed unions).
7. `apps/web/src/lib/live-sponsorships.ts`, `apps/web/src/lib/commerce.ts` `beginAffiliatePartnerHandoff`, and `apps/web/src/app/components/community-sponsored-cta.tsx`.
8. `apps/mobile/src/features/community/live-sponsorships.ts`, `sponsored-cta-impressions.tsx`, and `apps/mobile/components/community/community-sponsored-shop.tsx`.

Task owner map:

- Story 6.7b schema owner: the sponsorship table, constraints, indexes and RLS in `packages/db/prisma/schema.prisma` and `packages/db/prisma/migrations/20261024120000_community_post_sponsorship/migration.sql`.
- Story 6.7b seed owner: the test and local sponsorship on the top seeded spotlight post in `packages/db/prisma/seeds/commerce.ts`, deleted first by `packages/testing/src/cleanup.ts`.
- Story 6.7b operator owner: targeting, actor resolution and refusals in `apps/api/src/modules/commerce/community-sponsorship.cli.ts`, with closed codes in `apps/api/src/modules/commerce/community-sponsorship.constants.ts`.
- Story 6.7b operator transaction owner: link, end, dry run and audit rows in `apps/api/src/modules/commerce/community-sponsorship-operator.service.ts`, entered through `scripts/community-sponsorship.ts`.
- Story 6.7b eligibility owner: the batched query in `apps/api/src/modules/commerce/commerce.repository.ts` and the per-viewer chain in `apps/api/src/modules/commerce/community-sponsorship.service.ts`.
- Story 6.7b projection owner: header negotiation and block attachment in `apps/api/src/modules/community/community.controller.ts`, with `Vary` in `apps/api/src/modules/community/community-cache-headers.middleware.ts`.
- Story 6.7b click owner: the community branch and re-check in `apps/api/src/modules/commerce/affiliate-click.service.ts`.
- Story 6.7b contract owner: the opt-in header and sponsored variants in `packages/api-client/src/contracts/http/community.ts`, the block and surfaces in `packages/api-client/src/contracts/http/commerce.ts`.
- Story 6.7b analytics owner: the surface-keyed unions in `packages/api-client/src/types/analytics-events.ts`.
- Story 6.7b web ledger owner: read-start ordering in `apps/web/src/lib/live-sponsorships.ts`, applied in `apps/web/src/app/components/community-lookbook-grid.tsx`.
- Story 6.7b web CTA owner: disclosure, handoff and shown events in `apps/web/src/app/components/community-sponsored-cta.tsx`, the tab handoff in `apps/web/src/lib/commerce.ts`.
- Story 6.7b mobile ledger owner: read-start ordering in `apps/mobile/src/features/community/live-sponsorships.ts`, applied in `apps/mobile/src/features/community/community-screen.tsx`.
- Story 6.7b mobile CTA owner: the Shop control in `apps/mobile/components/community/community-sponsored-shop.tsx`, the visit rule in `apps/mobile/src/features/community/sponsored-cta-impressions.tsx`.

Tests that cover this step:

The map lists what each file asserts.
Run results are reported by the sessions that ran them and are listed under `Evidence boundaries`.

Contract, seed and fixture tests:

- [`packages/api-client/testing/commerce-contract.spec.ts`](../../packages/api-client/testing/commerce-contract.spec.ts): the community member on both CTA events, its rejection of `scenario`, `recommendationId` and identifiers, and hero and advisor members that still require their fields (`6.7b-CON-001` to `006`).
- [`packages/db/test/commerce-seed.spec.ts`](../../packages/db/test/commerce-seed.spec.ts): the seed sponsors rank 1 of the seeded spotlight cohort by an adult author, open-ended, once, and writes nothing outside test or local (`6.7b-DB-001` to `004`).
- [`packages/testing/test/cleanup.spec.ts`](../../packages/testing/test/cleanup.spec.ts): sponsorship links are deleted before the offers, posts and users they reference (`6.7b-TEST-001`).

API unit tests:

- [`apps/api/src/modules/commerce/community-sponsorship.service.spec.ts`](../../apps/api/src/modules/commerce/community-sponsorship.service.spec.ts): one batched lookup per page, saved locale before `Accept-Language`, flag off and opt-out short-circuits, and the click re-check's exact inputs.
- [`apps/api/src/modules/commerce/community-sponsorship.cli.spec.ts`](../../apps/api/src/modules/commerce/community-sponsorship.cli.spec.ts): the `agr_` ULID rule, the env file as the only `DATABASE_URL` source, and refusal of an unparseable remote target before any connection.
- [`apps/api/src/modules/commerce/community-sponsorship.script.spec.ts`](../../apps/api/src/modules/commerce/community-sponsorship.script.spec.ts): the real entry exits 1 with the confirm-target refusal for a remote pooler URL on a `.invalid` host (`6.7b-UNIT-043`).
- [`apps/api/src/modules/commerce/affiliate-click.service.spec.ts`](../../apps/api/src/modules/commerce/affiliate-click.service.spec.ts): the community branch runs before dedupe, refuses an advisor offer, stores the post id and `scenario = 'community'`, and keeps 503 and 403 precedence (`6.7b-API-CLICK-001` to `007`).
- [`apps/api/src/modules/community/community-sponsorship.controller.spec.ts`](../../apps/api/src/modules/community/community-sponsorship.controller.spec.ts): the block only on sponsored items, today's shape without the header, and `Vary` on every public read route and on middleware refusals.
- [`apps/api/src/modules/community/community-privacy.http.spec.ts`](../../apps/api/src/modules/community/community-privacy.http.spec.ts): an opted-in block stays private to the requesting viewer (`6.7b-UNIT-020`).
- [`apps/api/src/modules/telemetry/telemetry.affiliate.service.spec.ts`](../../apps/api/src/modules/telemetry/telemetry.affiliate.service.spec.ts): a community click event carries only partner, offer, surface and region, and refuses identifiers before anything is written.

Real-infrastructure API integration tests:

- [`apps/api/integration/community-sponsorship-eligibility.integration.spec.ts`](../../apps/api/integration/community-sponsorship-eligibility.integration.spec.ts): every eligibility row, the inclusive start and exclusive end on one pinned clock for link and offer, the raw visibility predicate matching the Prisma one, the erasure cascade, and audit rows that stay.
- [`apps/api/integration/community-sponsorship-operator.integration.spec.ts`](../../apps/api/integration/community-sponsorship-operator.integration.spec.ts): exactly one link and one audit row per change, dry runs that write nothing, every refusal on link and end, the single open link, and rollback when the audit insert fails.
- [`apps/api/integration/community-sponsorship-http.integration.spec.ts`](../../apps/api/integration/community-sponsorship-http.integration.spec.ts): feed, post, spotlight and teaser with and without reactions, `Vary`, link and end applying on the next read with the read model warm, identical region on every surface, and 200 with no blocks when the query fails.
- [`apps/api/integration/community-sponsorship-clicks.integration.spec.ts`](../../apps/api/integration/community-sponsorship-clicks.integration.spec.ts): a minted row per community surface, the ended-link replay inside 60 seconds, every 404 case with no row, the author clicking their own withdrawn or flagged post, and flag and opt-out precedence.

Web component and unit tests:

- [`apps/web/src/lib/community-sponsorship.test.ts`](../../apps/web/src/lib/community-sponsorship.test.ts): both opt-in headers on every live read, strict parsing of the block, and the shown-event region rule.
- [`apps/web/src/lib/live-sponsorships.test.ts`](../../apps/web/src/lib/live-sponsorships.test.ts): the ledger's read-start ordering and its viewer reset.
- [`apps/web/src/app/components/community-sponsored-cta.test.tsx`](../../apps/web/src/app/components/community-sponsored-cta.test.tsx): disclosure on the eligible card only, the tab claimed inside the gesture with no opener and no referrer, the CTA as its own Tab stop, ended-link and blocked-tab errors that keep focus, one shown event per visit, the Show new looks reveal, overlapping reads, and axe.
- [`apps/web/src/app/components/home-spotlight-teaser.sponsored.test.tsx`](../../apps/web/src/app/components/home-spotlight-teaser.sponsored.test.tsx): the teaser CTA beside its link, a `home_teaser` click, one shown event across an unmount and remount, and the Tab stop.
- [`apps/web/src/app/components/palette-advisor-panel.sponsored.test.tsx`](../../apps/web/src/app/components/palette-advisor-panel.sponsored.test.tsx): the palette advisor CTA claims the tab in the gesture, closes it on a failed mint, and mints nothing when the tab is blocked.
- [`apps/web/src/app/components/community-spotlight.hook.test.tsx`](../../apps/web/src/app/components/community-spotlight.hook.test.tsx): each landed spotlight page gets its own read token, and superseded or failed reads hand none back (`6.7b-WEB-026`).

Mobile component and unit tests:

- [`apps/mobile/src/lib/community-sponsorship.test.ts`](../../apps/mobile/src/lib/community-sponsorship.test.ts): both opt-in headers on feed and post reads and strict refusal of an extra block field.
- [`apps/mobile/src/lib/commerce.test.ts`](../../apps/mobile/src/lib/commerce.test.ts): a block renders only when the item carries one that passes the strict contract.
- [`apps/mobile/src/features/community/live-sponsorships.test.ts`](../../apps/mobile/src/features/community/live-sponsorships.test.ts): resolve copies take the latest live answer, a later read without the block removes it, and an older read landing last loses.
- [`apps/mobile/components/community/community-card.test.tsx`](../../apps/mobile/components/community/community-card.test.tsx): the Partnered pill renders only from the item's sponsorship.
- [`apps/mobile/components/community/community-sponsored-shop.test.tsx`](../../apps/mobile/components/community/community-sponsored-shop.test.tsx): mint then in-app browser for feed, spotlight and teaser, the CTA outside the open target, the label that says it opens a browser, one shown event per visit, and error states that keep focus.
- [`apps/mobile/src/screens/community-screen.test.tsx`](../../apps/mobile/src/screens/community-screen.test.tsx): registers the sponsored screen cases, which prove no block is persisted, live rebuilds remove a dropped block, and overlapping reads resolve to the newest (`6.7b-MOB-050` to `060`).
- [`apps/mobile/src/screens/home-spotlight-teaser.test.tsx`](../../apps/mobile/src/screens/home-spotlight-teaser.test.tsx): a foreground return is not a new visit, nothing persists a block, and a failed re-read drops the CTA without a second impression.
- [`apps/mobile/src/screens/home-spotlight-teaser-native.test.tsx`](../../apps/mobile/src/screens/home-spotlight-teaser-native.test.tsx): focus recovery when the teaser or only its sponsorship leaves while Shop is focused (`6.7b-MOB-063` to `066`).

Pact contract tests:

- [`pact/http/consumer/web-api-client.pacttest.ts`](../../pact/http/consumer/web-api-client.pacttest.ts) and [`pact/http/consumer/mobile-api-client.pacttest.ts`](../../pact/http/consumer/mobile-api-client.pacttest.ts): opted-in feed, spotlight, teaser and post reads recorded through each app's own read wrapper, and the ended-link 404 on all three click surfaces, from the interactions in `pact/http/consumer/interactions/community/sponsorship.ts` and `commerce-affiliate.ts`.
- [`pact/http/provider/api-provider.pacttest.ts`](../../pact/http/provider/api-provider.pacttest.ts): replays both consumers against real controllers with the sponsorship provider states and doubles.

Playwright end-to-end tests:

- [`playwright/tests/community-sponsored-highlights.spec.ts`](../../playwright/tests/community-sponsored-highlights.spec.ts): disclosure, shown event and click on the spotlight card, feed card and detail dialog, and narrow Home teaser; a blocked popup; opt-out hiding the CTA on the next read; legacy strict parsing without the header; and a sponsored look revealed through Show new looks (`6.7b-E2E-01` to `11`).

Mobile end-to-end test:

- [`maestro/community-sponsored-highlights.yaml`](../../maestro/community-sponsored-highlights.yaml): the Partnered disclosure and CTA on the Home teaser and the spotlight module card, with the in-app browser's URL bar naming the seeded partner host on Android and iOS.

Evidence boundaries:

- **Source-comment follow-up.**
  33 of the 33 linked source files in this test map lack a Step 47 cross-link comment in the reviewed Git snapshot.
  This document-only review leaves those source comments for a repository change.

- **Local review artifacts.**
  The cited `story-*` review records are retained locally under `_bmad-output/test-artifacts/` and ignored by Git.
  A fresh checkout can use the tracked story spec as the portable account of those findings.

- **Every run figure here is reported.**
  This step ran no suite.
  The test quality score of 54 before and 100 after comes from `cc67b-tea-test-review.md`.
  CI on `0e5d804a` with all 12 workflows green and 33 PR checks passing, the 59-passed community Playwright run, and the Maestro durations (116 s median for the sponsored flow, 152 s and 109 s for the split feed flows) come from `code-triage-1.md` and `scripts/maestro-flow-durations.json`.
- **No tier proves a real partner handoff.**
  The seeded partner host `partner.couturecast.test` never resolves, so the Maestro flow proves the in-app browser opened on the minted URL and stops at the error page.
  Conversion attribution for community clicks rides on Step 33's webhook, which this story did not change.
- **No production sponsorship exists.**
  The operator command has been exercised against isolated local databases and against a `.invalid` remote host that it must refuse; no evidence shows it run against a real Supabase project.
- **No manual VoiceOver or TalkBack pass is recorded.**
  Disclosure, focus and announcement rules are proved by component tests and by Maestro selectors that read accessible labels.
- **The new locale strings are checked for presence.**
  The parity specs prove every key exists in all ten catalogs on both clients; this step found no record of native-speaker review for them.
- **Two package-build races remain by decision.**
  D2 and D3 in `code-triage-1.md` accept that a reader already executing an old `dist` tree can meet a deleted module during a concurrent publish; CI and Vercel build serially.
- **CodeRabbit did not review PR #161**, because it exceeds the 100-file cap; two independent reviewers approved every round through R33, and R34 was the coordinator's D5 change with its own red and green evidence.

Architecture diagram:

```mermaid
flowchart TD
  Owner["Owner runs npm run community:sponsorship"] --> CLI["community-sponsorship.cli.ts\n--env-file only, --confirm-target for remote\nadmin actor, agr_ ULID, closed reason codes"]
  CLI --> Tx["One transaction\nCommunityPostSponsorship row + AuditLog row"]
  Tx --> Table[("CommunityPostSponsorship\nRLS on, zero client grants\none open link per post")]

  Reader["Opted-in client\nx-couture-sponsorship: 1"] --> Read["Feed, post or spotlight read\nspotlight Redis model keeps ids only"]
  Read --> Attach["CommunityController.attachSponsorships"]
  Attach --> Chain{"flag on, not opted out,\nregion from saved locale\nor Accept-Language"}
  Chain -- "any failure" --> NoBlock["no block, read still 200"]
  Chain -- "pass" --> Query["findEligibleCommunitySponsorships\none batched query, UTC window,\ngarment offer, active partner, public post"]
  Table --> Query
  Query --> Block["sponsorship block\npartner, offer, title. No URL"]
  Block --> Ledger["LiveSponsorshipLedger per viewer\nnewest read start wins\nresolve copies take latest live answer"]
  Ledger --> CTA["Partnered + Shop this look\nfeed, spotlight, detail, Home teaser"]

  CTA --> Click["POST /commerce/affiliate/clicks\nsurface community_feed, community_spotlight\nor home_teaser, recommendationId = postId"]
  Click --> Recheck{"same eligibility query\nfor this post and offer,\nbefore dedupe"}
  Recheck -- "no link" --> NotFound["404, no row, no redirect"]
  Recheck -- "eligible" --> Mint["AffiliateClick\nscenario community"]
  Mint --> Event["affiliate_cta_clicked community member\npartner, offer, surface, region only"]
  Mint --> Open["web: tab claimed in the gesture, no opener, no referrer\nmobile: in-app browser"]
```

## Step 48: Safe branded share-card export

User/business impact:

A member can turn their own published look, or a saved outfit recommendation, into a branded CoutureCast card.
They see the exact PNG before they keep it, can switch the watermark on or off, and can save it to Photos on iOS, to the gallery on Android, or download it on web.
The card carries the member's own photo or bundled category artwork, fixed localized labels and the brand mark.
A community card includes the climate band when one is available.
The renderer adds no caption, handle, city, date, signed URL, source ID or file metadata.
Personal information already visible inside the member's photograph remains visible in the card.
Every save re-renders the card on the server, checks that the bytes match the preview, rechecks eligibility and consent, and writes one audit row.
Story 6.9 (Step 49) hands the same prepared bytes to the OS share sheet.

Key takeaways:

1. **Render the card on the server from a closed projection.**
   Capturing the existing UI would copy personal fields and signed URLs into the image.
   `ShareCardSourceRepository` reduces each source to a small projection (scenario and category enums for an outfit, a validated storage path and climate band for a post), and `ShareCardRenderer` draws only catalog strings, bundled SVG artwork and the member's own photo.
   The photo is decoded, orientation-corrected, cover-cropped and composited as raw sRGB pixels, so source metadata cannot reach the output.
2. **Preview the exact bytes, then save only those bytes.**
   `POST /api/v1/share-cards/prepare` takes `purpose:'preview'` or `purpose:'save'` with `expectedSha256`.
   A save re-resolves the source, re-renders it and compares digests.
   Any change returns 409 `preview_changed`, keeps the old preview visible with Save disabled, and offers Refresh preview.
   The same source, locale, watermark and template version always produce the same PNG and SHA-256.
3. **Allowlist the PNG chunks after encoding and check them everywhere.**
   `stripShareCardMetadata` in `share-card-png.ts` rebuilds the encoder output from `IHDR`, `IDAT` and `IEND` alone.
   `validateShareCardPng` in `packages/api-client/src/share-card-png.ts` checks the same rule on the server and both clients, and the iOS adapter re-checks signature, CRCs, 1080x1350 dimensions, chunk order and digest in Swift before it writes.
4. **Authorize twice, and once more inside the audit transaction.**
   The service resolves the source before rendering and again after it.
   A save then inserts the `share_card_export_authorized` audit row and calls `resolveGuarded` in the same transaction, so a withdrawal or consent change during the audit insert rolls the authorization back.
   The audit row holds only `{sourceKind, locale, watermark, templateVersion}`.
5. **Bound every stage of the render.**
   The whole prepare has a 15-second deadline that includes queue time.
   Storage reads get 5 seconds and 10 MiB, each Sharp stage gets 5 seconds, and the decoded PNG is capped at 3 MiB.
   `ShareCardAdmission` allows 4 renders at once, one per member, plus one replaceable waiter after a cancelled predecessor.
   A client disconnect aborts the controller, and Sharp stages stop through `runAbortableSharp`.
6. **A library's save call can change your bytes.**
   Expo SDK 54's `MediaLibrary.saveToLibraryAsync` decodes a PNG into a `UIImage` before saving on iOS, so it cannot keep the approved bytes.
   The local Expo module `share-card-photo-save` imports the file as the original Photos resource through `PHAssetCreationRequest.addResource(with:.photo, fileURL:options:)` with add-only access.
   Android keeps `saveToLibraryAsync`, and the native lanes extract the saved file on both platforms and compare its SHA-256 with the preview.
7. **One process-lifetime owner holds a committed native save.**
   `share-card-save-operations.ts` takes the temp file at an atomic commit point, right before the native call.
   Before commit, Cancel or sign-out aborts and deletes the file.
   After commit, nothing the UI does can delete the file or release the duplicate-write guard until the native promise settles; then cleanup runs once, with retries at 1, 5 and 30 seconds if it fails.
8. **Resolve optional native modules and say why a control is off.**
   The iOS adapter loads through `requireOptionalNativeModule`, following the accessibility-focus precedent.
   In Expo Go or an older client, preview and Cancel keep working and Save is disabled with the localized `nativeSaveUnavailable` message.
   There is no re-encoding fallback.
9. **Keep hour-long device lanes off pull requests and gate them by event.**
   `pr-share-card-native.yml` runs `browser-acceptance` and `share-card-lanes-gate` on pull requests.
   Every device lane (API 32, the three API 36 partitions, the iOS build, both iOS shards, `ios-expo-go` and the evidence job) runs on push to `main`, nightly and dispatch, to keep device work outside the pull-request timing budget.
   Their configured timeouts differ; the iOS evidence aggregation job has a five-minute timeout.
   `scripts/ci/share-card-lanes.mjs` checks the workflow shape, and the gate expects device lanes skipped on `pull_request` and green on every other event.

Hard-won lessons from the implementation and code review of this story:

1. **The first spec trusted the Expo save call to keep PNG bytes.**
   Both pre-implementation reviews (Astra A1 high, TEA T1 high) read SDK 54's `MediaLibraryModule.swift` and `SaveToLibraryDelegate.swift` and found the `UIImage` decode.
   The spec gained the original-resource adapter and the `N-IOS-ORIGINAL` proof, which must extract the actual Photos resource.
   The final iOS and Android proofs report the same resource: SHA-256 `a1657c67ce12ed6395478013e3482a5e8404682403a167dbe7b7e96b86398e59`, 38,398 bytes, only `IHDR`/`IDAT`/`IEND`.
2. **Thirteen confirmed code findings came out of the first implementation review.**
   The service checked eligibility, then awaited the audit insert, then checked only cancellation, so a withdrawal during the insert still authorized a save (B4 high).
   After React unmount, a pending save authorization could still hand off a download or a native write (E1 and E2 high).
   Client disconnect did not cancel storage and render work (B1), the renderer ignored the operation deadline between Sharp stages (B2), and nothing bounded concurrent renders (B3).
   A real transport error reached the member as a render or storage failure (B5).
   Closing a retained preview left "Saving" on screen (B7), and failed cleanup only retried at the next app start (B8).
   The Playwright config ran Chromium only, so WebKit's asynchronous download handoff had no coverage (B10).
   The original repair required 45 cases across three engines.
   On `main` at `185e827c`, the matrix has 50 cases per engine: four behaviors in each of ten locales plus ten shared cases, for 150 executions across Chromium, Firefox and WebKit.
   Removing the text overlay call left every test green, because no test read painted pixels (V1); the renderer spec now decodes heading, scenario, category, climate and footer regions.
   The per-finding record is `_bmad-output/test-artifacts/story-6-8/reviews/local-review-round1-triage.json`.
3. **A shared font-scale repair made Android text vanish.**
   Stock Release live scaling from 1.0 to 1.5 clipped Home, feed, Spotlight detail and Settings on React Native 0.81.5 Fabric.
   A shared `AppText` primitive across 27 import sites kept only 5 of 44 visible text nodes after the change; unchanged `main` at `1d7b9848` kept 43 of 43.
   The repair was reverted in `51d29f19`, and the clipping fix (upstream RN commit `45904c8`, first in RN 0.87.0) moved to Story 6.15, the Expo SDK 58 upgrade.
   The Release proof now checks the exact text multiset on Home (43), feed (26), post detail (16) and settings (28), and records the card title at 92 px before and after.
4. **Android Activity recreation dropped the open composer.**
   A live font change recreated the Activity and the Fabric root, the card disappeared, and the restored preview then got HTTP 401 in the gap between root auth effects.
   A root-owned host now keeps a process-memory draft (source IDs, verified member, watermark, open state) and a successor lease prepares fresh bytes.
   The bearer boundary resolves the secure native session lazily across roots.
5. **Apple's accessibility audit flags rasterized text it cannot attribute to an element.**
   The strict `.all` audit in XCUITest reported nil-element `Potentially inaccessible element` and `Potentially inaccessible text` over the card image.
   The coordinator allowed exactly those two compact and detailed signatures, in named states only, with nil element and `elementDetection` type.
   The server now returns an `accessibilityLabel` built from the same strings that enter the render, including a localized `watermarkRole`.
   Every other audit issue still fails, and near-miss tests reject altered text, type, state and non-nil elements.
6. **A Maestro driver can collide with a device port, and a pattern kill hits other sessions.**
   An Android run failed before any command because Maestro's gRPC server could not bind port 49998 on the device; both test launch paths now pin driver port 17001.
   On the shared Mac, `killStaleIosDrivers()` used `pkill -f` and killed other sessions' drivers, so `97c7a1fc` replaced it with `scripts/lib/maestro-ios-driver-ownership.mjs`, which records spawned PIDs in a pidfile and kills only those.
7. **Several red CI runs traced to runner infrastructure.**
   `setup-android` requested the removed SDK package `tools`, so the job installs `platform-tools`.
   On macOS, Docker-backed Supabase kept missing its 600-second startup budget.
   ARM runners ran Colima under software emulation (TCG), a cold GHCR pull of one 650.8 MB layer took about 553 seconds, and `docker load` streamed every decompressed byte through Colima's SSH-forwarded socket.
   The spec records an Intel runner, a Linux prewarm archive and loading inside the VM as successive repairs.
   The merged workflow drops Docker on macOS: the iOS jobs run on `macos-15`, and `scripts/ci/native-supabase.mjs` builds Supabase as native processes from pinned, checksum-verified sources, cached as soon as each build exists.
8. **A local-only Postgres extension broke privacy transactions.**
   The Supabase image preloads `plpgsql_check`, whose `pldbgapi2` layer aborted `community_prepare_subject_privacy` with SQLSTATE `XX000` once in each of two full coverage runs (upstream okbob/plpgsql_check#197).
   CI's stock `postgres:17-alpine` never loads it.
   `apps/api/src/prisma/prisma-client.ts` now retries exactly that error in both Prisma forms, three attempts in all, and a guard spec fails on any other `$transaction` or `new PrismaClient(` in the API.
9. **Follow-up PR #165 (`3112efbd`): `tapOn` reports COMPLETED whether the app got the press or not.**
   The iOS lanes had not passed a full run after merge.
   `set-locale.yaml` now waits for the target button to read disabled, another button to read enabled, then the target disabled again, so a lost press or a rollback fails the attempt.
   `open-post.yaml` retries the opener tap, guarded by `notVisible` on `share-card-title`, because a late press had already opened the composer and the next tap landed on its controls.
   The focus-observation harness resolved the app container with a synchronous `simctl` call on every request, which blocked the Node event loop past the 2-second client timeout on a host with load1 above 100; it now resolves once, asynchronously.
10. **A Maestro wait that runs a second time returns at once.**
    In run 41019906459 attempts 2 to 4 of a 45-second wait took 54.4 seconds in all, so a retry or repeat cannot hold a time window.
    `expo-go-open.yaml` uses three one-shot waits in order, and its flow tests refuse both patterns.
11. **The Expo Go proof never passed in CI until it ran alone and Metro ran offline.**
    It failed in every run that reached it as the last step of iOS shard 2, where the host had 74 MB free.
    PR #165 moved it to its own `ios-expo-go` job.
    PR #166 (`185e827c`) found the root cause: online, the Expo CLI tries to fetch a development certificate for the Expo account, has no login in CI, and Metro answers HTTP 500, so Expo Go sits on its loading screen.
    Offline, the CLI serves the manifest unsigned.
    On CI's iOS 18.5 the developer-menu sheet also lives in a window Maestro cannot read and hides `tab-home`, so the flow taps the backdrop above it.
    With both fixes the lane joined `share-card-lanes-gate`.
12. **The story PR carried more than the share card.**
    `67806196` changed 879 paths, including several rounds of community text-screening repair and per-locale holdouts.
    At merge, `active-holdout.json` gates six locales on `holdout-v6` and Portuguese on `holdout-v8`; v4 and v5 are retired to development data after failing their Wilson gates (`cc68-tea-text-holdout-v5.md`: Italian 4/1000 withheld, upper bound 1.023956%).

Story/Task mapping:

- Story 6.8
- Task 1 (strict prepare contract, generated SDK and OpenAPI)
- Task 2 (API module: source resolution, bounded media, deterministic render, fresh PNG, audit)
- Task 3 (bundled fonts, artwork and ten-locale render catalogs in the production build)
- Task 4 (web dialog, ritual launcher, own-post actions, Blob download)
- Task 5 (mobile composer, guarded native save, save-operation owner)
- Task 6 (local iOS `share-card-photo-save` module)
- Task 7 (media library dependency, permissions and dev-client builds)
- Task 8 (`shareCard` namespace in ten locales on both clients)
- Task 9 (unit and real-database integration tests for every U and I ID)
- Task 10 (Pact interactions and the Playwright share-card spec)
- Task 11 (Maestro flows and the `run-story68-native.mjs` harness)
- Task 12 (`pr-share-card-native.yml` and the lane gate)

Story reference:

- `_bmad-output/implementation-artifacts/spec-6-8-safe-branded-share-card-export.md`, including its I/O matrix, Implementation Notes, Spec Change Log and Review Triage Log
- `_bmad-output/test-artifacts/story-6-8/reviews/cc68-tea-text-holdout-v4.md` and `cc68-tea-text-holdout-v5.md`
- `_bmad-output/test-artifacts/story-6-8/text-repair-round6-amendment-1.json`
- Merge commit `67806196` (PR #162) and follow-ups `3112efbd` (PR #165) and `185e827c` (PR #166)

Cross-links:

- Step 38 (Story 6.1) provides `isPubliclyVisiblePost`, `CommunityService.readAuthorized`, the community storage adapter and the 1,950 ms authorization budget the export reuses.
- Step 39 (Story 6.2) provides the image validation that decodes and checks source photos.
- Step 40 (Story 6.2b) provides the screening release gate whose text repairs and holdouts shipped in this PR.
- Step 43 (Story 6.5) provides the realtime 100-socket budget proof that this PR moved to a dedicated CI runner.
- Step 44 (Story 6.6) provides the Spotlight render sites that also carry the export action.
- Step 28 provides the keyboard, focus and assistive-technology baseline.
- Step 22 provides catalog parity across ten locales.
- Step 49 (Story 6.9) shares the same prepared bytes through the OS share sheet.

Sequence to follow:

1. `packages/api-client/src/contracts/http/share-cards.ts` for the strict request branches and the closed response.
2. `apps/api/src/modules/share-cards/share-cards.controller.ts` for the disconnect handling and `Cache-Control: private, no-store`.
3. `apps/api/src/modules/share-cards/share-cards.service.ts` for the deadline, admission, the two resolves, the digest check and the audit transaction.
4. `apps/api/src/modules/share-cards/share-card-source.repository.ts` for the projection and the eligibility rules.
5. `apps/api/src/modules/share-cards/share-card-renderer.ts`, `share-card-font.ts` and `share-card-png.ts` for the layout, glyph check and chunk allowlist.
6. `apps/api/src/modules/share-cards/share-card-admission.ts` and `apps/api/src/common/abortable-sharp.ts` for the bounds.
7. `packages/api-client/src/share-card-png.ts` for the PNG rule every client shares.
8. `apps/web/src/app/components/share-card-dialog.tsx` and `ritual-share-card-launcher.tsx` for the web preview, Blob download and focus.
9. `apps/mobile/components/share-card-composer.tsx` and `apps/mobile/components/android-share-card-presentation.tsx` for the mobile composer and the root-owned Android host.
10. `apps/mobile/src/lib/share-card-save.native.ts` and `share-card-save-operations.ts` for permission, commit and cleanup.
11. `apps/mobile/modules/share-card-photo-save/ios/ShareCardPhotoSaveModule.swift` and `ShareCardPngFile.swift` for the original-resource import.
12. `.github/workflows/pr-share-card-native.yml`, `scripts/ci/share-card-lanes.mjs` and `scripts/run-story68-native.mjs` for how the device proof runs.

Task owner map:

The Story 6.8 owner labels below are document navigation labels.
Source files still need the matching owner comments.

- Story 6.8 Task 1 step 1 owner: define the prepare contract in `packages/api-client/src/contracts/http/share-cards.ts`.
- Story 6.8 Task 2 step 1 owner: orchestrate deadline, admission, rechecks and audit in `apps/api/src/modules/share-cards/share-cards.service.ts`.
- Story 6.8 Task 2 step 2 owner: resolve sources into closed projections in `apps/api/src/modules/share-cards/share-card-source.repository.ts`.
- Story 6.8 Task 2 step 3 owner: render the deterministic card in `apps/api/src/modules/share-cards/share-card-renderer.ts`.
- Story 6.8 Task 2 step 4 owner: rebuild the PNG from allowed chunks in `apps/api/src/modules/share-cards/share-card-png.ts`.
- Story 6.8 Task 2 step 5 owner: bound concurrent renders in `apps/api/src/modules/share-cards/share-card-admission.ts`.
- Story 6.8 Task 3 step 1 owner: ship fonts, artwork and render catalogs from `apps/api/src/modules/share-cards/assets/` through `apps/api/nest-cli.json`.
- Story 6.8 Task 4 step 1 owner: preview and download on web in `apps/web/src/app/components/share-card-dialog.tsx`.
- Story 6.8 Task 4 step 2 owner: prepare a real ritual card on web in `apps/web/src/app/components/ritual-share-card-launcher.tsx`.
- Story 6.8 Task 5 step 1 owner: compose, preview and save on mobile in `apps/mobile/components/share-card-composer.tsx`.
- Story 6.8 Task 5 step 2 owner: own committed native saves in `apps/mobile/src/lib/share-card-save-operations.ts`.
- Story 6.8 Task 5 step 3 owner: check permission and commit the save in `apps/mobile/src/lib/share-card-save.native.ts`.
- Story 6.8 Task 6 step 1 owner: import the original PNG into Photos in `apps/mobile/modules/share-card-photo-save/ios/ShareCardPhotoSaveModule.swift`.
- Story 6.8 Task 11 step 1 owner: run the native proof in `scripts/run-story68-native.mjs`.
- Story 6.8 Task 12 step 1 owner: enforce lane triggers and the gate in `scripts/ci/share-card-lanes.mjs`.

Tests that cover this step:

The map says what each test asserts.
Run results are recorded in the spec's Implementation Notes and in `_bmad-output/test-artifacts/story-6-8/`; see `Evidence boundaries`.

API unit tests:

- [`apps/api/src/modules/share-cards/share-card-renderer.spec.ts`](../../apps/api/src/modules/share-cards/share-card-renderer.spec.ts): proves deterministic bytes with an independent watermark, own photo pixels kept while source metadata is dropped, painted text in every label region, a transparent photo composited onto the card background, a missing font failing before any system fallback, and cancellation between Sharp stages.
- [`apps/api/src/modules/share-cards/share-card-source.repository.spec.ts`](../../apps/api/src/modules/share-cards/share-card-source.repository.spec.ts): proves outfit and post eligibility, the shared 404 for unknown and foreign sources, and the capsule revision check.
- [`apps/api/src/modules/share-cards/share-cards.service.spec.ts`](../../apps/api/src/modules/share-cards/share-cards.service.spec.ts): proves the 409 on a changed composition or stale digest, the real 15-second deadline with no late result or audit, admission held until actual settlement, the replaceable waiter, and a refusal after the audit insert rolling back the grant.
- [`apps/api/src/modules/share-cards/share-cards.controller.spec.ts`](../../apps/api/src/modules/share-cards/share-cards.controller.spec.ts): proves input rejection, `private, no-store`, and that a client disconnect aborts while a completed body close does not.
- [`apps/api/src/modules/share-cards/share-card-admission.spec.ts`](../../apps/api/src/modules/share-cards/share-card-admission.spec.ts): proves the global and per-member bounds and the single replaceable waiter.
- [`apps/api/src/modules/community/community-storage-bounded.spec.ts`](../../apps/api/src/modules/community/community-storage-bounded.spec.ts): proves unsafe paths are refused before any request, declared and actual overruns cancel the stream, and a stalled read stops at five seconds with no partial bytes.
- [`apps/api/src/common/abortable-sharp.spec.ts`](../../apps/api/src/common/abortable-sharp.spec.ts): proves an aborted signal stops a Sharp stage.

Shared contract tests:

- [`packages/api-client/testing/share-cards-contract.spec.ts`](../../packages/api-client/testing/share-cards-contract.spec.ts): proves the strict request branches, rejection of URLs, paths and extra fields, and the closed response.
- [`packages/api-client/testing/share-card-png.spec.ts`](../../packages/api-client/testing/share-card-png.spec.ts): proves the shared PNG validator accepts only the three chunks at the fixed size.
- [`packages/api-client/testing/share-cards-client.spec.ts`](../../packages/api-client/testing/share-cards-client.spec.ts): proves the deadline-aware prepare wrapper.

Real-PostgreSQL integration test:

- [`apps/api/integration/share-card-export.integration.spec.ts`](../../apps/api/integration/share-card-export.integration.spec.ts): proves every I ID in the matrix against a real database and a controlled storage stream, including access refusals, media limits, privacy bait, audit failure and synchronized source, consent and moderation races.

Web tests:

- [`apps/web/src/app/components/share-card-dialog.test.tsx`](../../apps/web/src/app/components/share-card-dialog.test.tsx): proves the modal focus lifecycle, stale-result dropping, Save gating on a loaded preview, Blob handoff and one announcement per state.
- [`apps/web/src/app/components/ritual-share-card-launcher.test.tsx`](../../apps/web/src/app/components/ritual-share-card-launcher.test.tsx): proves the launcher waits for profile verification before any bearer request, cancels a former member's work, and fails offline before resolving a session.
- [`apps/web/src/app/components/community-share-card-eligibility.test.tsx`](../../apps/web/src/app/components/community-share-card-eligibility.test.tsx) and [`community-share-card-host.test.tsx`](../../apps/web/src/app/components/community-share-card-host.test.tsx): prove export appears only on an own post that is published with a published timestamp, including Spotlight posts absent from the feed, and that focus and re-verification unwind correctly.
- [`apps/web/src/lib/share-cards.test.ts`](../../apps/web/src/lib/share-cards.test.ts): proves digest validation, offline refusal, and that cancellation or a handoff error revokes the object URL.
- [`apps/web/src/i18n/share-card-locales.spec.ts`](../../apps/web/src/i18n/share-card-locales.spec.ts): proves the `shareCard` namespace is complete in ten catalogs and agrees with the API render strings.

Mobile tests:

- [`apps/mobile/components/share-card-composer.test.tsx`](../../apps/mobile/components/share-card-composer.test.tsx): proves the composer states, permission branches, retry, focus restoration and unmount cancellation.
- [`apps/mobile/components/share-card-presentation.test.tsx`](../../apps/mobile/components/share-card-presentation.test.tsx) and [`share-card-session-recreation.test.tsx`](../../apps/mobile/components/share-card-session-recreation.test.tsx): prove the Android root-owned draft survives root replacement and that identity changes destroy it.
- [`apps/mobile/components/share-card-tab-heading.test.tsx`](../../apps/mobile/components/share-card-tab-heading.test.tsx): proves the focus fallback heading.
- [`apps/mobile/src/lib/share-card-save-operations.spec.ts`](../../apps/mobile/src/lib/share-card-save-operations.spec.ts): proves U-PENDING-FILE, U-SINGLE-WRITE and U-STORAGE: the file stays readable until settlement, one write, cleanup once, and no completion UI for another member.
- [`apps/mobile/src/lib/share-card-save.native.spec.ts`](../../apps/mobile/src/lib/share-card-save.native.spec.ts): proves digest checks before write, the commit boundary, the iOS adapter call and Android MediaLibrary.
- [`apps/mobile/src/lib/share-cards.spec.ts`](../../apps/mobile/src/lib/share-cards.spec.ts), [`share-card-focus.spec.ts`](../../apps/mobile/src/lib/share-card-focus.spec.ts), [`share-card-native-fixture.spec.ts`](../../apps/mobile/src/lib/share-card-native-fixture.spec.ts) and [`use-share-card-status-bar.spec.tsx`](../../apps/mobile/src/lib/use-share-card-status-bar.spec.tsx): prove the prepare client, native focus, the test-build-only fixture modes and status bar handling.
- [`apps/mobile/src/i18n/share-card-locales.spec.ts`](../../apps/mobile/src/i18n/share-card-locales.spec.ts): proves the mobile namespace in ten catalogs.
- [`apps/mobile/plugins/with-share-card-permissions.test.js`](../../apps/mobile/plugins/with-share-card-permissions.test.js) and [`with-story68-release-network.test.js`](../../apps/mobile/plugins/with-story68-release-network.test.js): prove the generated iOS and Android permissions keep add-only export beside image-picker access, and that the loopback network exception exists only for the isolated proof profile.

Native tests:

- [`apps/mobile/modules/share-card-photo-save/ios/Tests/ShareCardPhotoSaveTests.swift`](../../apps/mobile/modules/share-card-photo-save/ios/Tests/ShareCardPhotoSaveTests.swift): proves the Swift path, signature, CRC, dimension, chunk and digest checks.
- [`apps/mobile/native-tests/ShareCardAccessibilityUITests.swift`](../../apps/mobile/native-tests/ShareCardAccessibilityUITests.swift) and [`ShareCardFallbackUITests.swift`](../../apps/mobile/native-tests/ShareCardFallbackUITests.swift): run the strict `.all` audit across share-card states and the removed-opener focus fallback; this is the approved VoiceOver substitute.
- [`ShareCardComposerTalkBackTest.kt`](../../apps/mobile/modules/accessibility-focus/android/src/androidTest/java/expo/modules/accessibilityfocus/ShareCardComposerTalkBackTest.kt) and [`ShareCardFallbackTalkBackTest.kt`](../../apps/mobile/modules/accessibility-focus/android/src/androidTest/java/expo/modules/accessibilityfocus/ShareCardFallbackTalkBackTest.kt): drive real TalkBack for modal focus, save ownership, Cancel restoration and the fallback cursor.

Pact contract tests:

- [`pact/http/consumer/interactions/share-cards.ts`](../../pact/http/consumer/interactions/share-cards.ts), exercised by [`mobile-api-client.pacttest.ts`](../../pact/http/consumer/mobile-api-client.pacttest.ts) and [`web-api-client.pacttest.ts`](../../pact/http/consumer/web-api-client.pacttest.ts) and replayed by [`api-provider.pacttest.ts`](../../pact/http/provider/api-provider.pacttest.ts): both source kinds, preview and save, denial and conflict.

Playwright end-to-end test:

- [`playwright/tests/share-card-export.spec.ts`](../../playwright/tests/share-card-export.spec.ts), run through `playwright/share-card.config.ts`: every P ID with real own-post and ritual fixtures; it parses the downloaded PNG's chunks and compares its digest with the displayed preview, across Chromium, WebKit and Firefox in CI.

Mobile end-to-end tests:

- [`maestro/share-card-export.yaml`](../../maestro/share-card-export.yaml) and the 37 flows under `maestro/story68/`, driven by `scripts/run-story68-native.mjs`: real save and denial, API 32 legacy permissions, cancel, pending, sign-out, rapid watermark under a held SQL barrier, locale, large text, the Release live-font proof and the Expo Go unavailable state.

Harness tests:

These tracked harness suites pin the lane policy, gate, flow budgets, failure classification, public evidence redaction and the native-runner repairs.
The follow-up PRs added locale-tap, post-opener, Metro-environment and Expo Go probe guards.

- [`scripts/ci/native-ios-expo-go-probe.test.mjs`](../../scripts/ci/native-ios-expo-go-probe.test.mjs)
- [`scripts/ci/share-card-android-release-font.test.mjs`](../../scripts/ci/share-card-android-release-font.test.mjs)
- [`scripts/ci/share-card-android.test.mjs`](../../scripts/ci/share-card-android.test.mjs)
- [`scripts/ci/share-card-browser-deps.test.mjs`](../../scripts/ci/share-card-browser-deps.test.mjs)
- [`scripts/ci/share-card-job-gate.test.mjs`](../../scripts/ci/share-card-job-gate.test.mjs)
- [`scripts/ci/share-card-lanes.test.mjs`](../../scripts/ci/share-card-lanes.test.mjs)
- [`scripts/ci/share-card-native-conditions.test.mjs`](../../scripts/ci/share-card-native-conditions.test.mjs)
- [`scripts/ci/share-card-native-services.test.mjs`](../../scripts/ci/share-card-native-services.test.mjs)
- [`scripts/lib/story68-api-entry.test.mjs`](../../scripts/lib/story68-api-entry.test.mjs)
- [`scripts/lib/story68-audit-failure-digest.test.mjs`](../../scripts/lib/story68-audit-failure-digest.test.mjs)
- [`scripts/lib/story68-bridge-unit-result.test.mjs`](../../scripts/lib/story68-bridge-unit-result.test.mjs)
- [`scripts/lib/story68-browser-watermark.test.mjs`](../../scripts/lib/story68-browser-watermark.test.mjs)
- [`scripts/lib/story68-cold-font-scale.test.mjs`](../../scripts/lib/story68-cold-font-scale.test.mjs)
- [`scripts/lib/story68-fallback-focus.test.mjs`](../../scripts/lib/story68-fallback-focus.test.mjs)
- [`scripts/lib/story68-fallback-post.test.mjs`](../../scripts/lib/story68-fallback-post.test.mjs)
- [`scripts/lib/story68-flow-timeouts.test.mjs`](../../scripts/lib/story68-flow-timeouts.test.mjs)
- [`scripts/lib/story68-gradle-precondition.test.mjs`](../../scripts/lib/story68-gradle-precondition.test.mjs)
- [`scripts/lib/story68-hide-keyboard-flows.test.mjs`](../../scripts/lib/story68-hide-keyboard-flows.test.mjs)
- [`scripts/lib/story68-hierarchy-driver.test.mjs`](../../scripts/lib/story68-hierarchy-driver.test.mjs)
- [`scripts/lib/story68-ios-focus-observation.test.mjs`](../../scripts/lib/story68-ios-focus-observation.test.mjs)
- [`scripts/lib/story68-metro-env.test.mjs`](../../scripts/lib/story68-metro-env.test.mjs)
- [`scripts/lib/story68-native-build-env.test.mjs`](../../scripts/lib/story68-native-build-env.test.mjs)
- [`scripts/lib/story68-native-evidence-schema.test.mjs`](../../scripts/lib/story68-native-evidence-schema.test.mjs)
- [`scripts/lib/story68-open-post-flow.test.mjs`](../../scripts/lib/story68-open-post-flow.test.mjs)
- [`scripts/lib/story68-outfit-opener-flows.test.mjs`](../../scripts/lib/story68-outfit-opener-flows.test.mjs)
- [`scripts/lib/story68-pick-image-tap.test.mjs`](../../scripts/lib/story68-pick-image-tap.test.mjs)
- [`scripts/lib/story68-prefs-failed-state.test.mjs`](../../scripts/lib/story68-prefs-failed-state.test.mjs)
- [`scripts/lib/story68-rapid-watermark-control.test.mjs`](../../scripts/lib/story68-rapid-watermark-control.test.mjs)
- [`scripts/lib/story68-rapid-watermark-flow.test.mjs`](../../scripts/lib/story68-rapid-watermark-flow.test.mjs)
- [`scripts/lib/story68-rapid-watermark.test.mjs`](../../scripts/lib/story68-rapid-watermark.test.mjs)
- [`scripts/lib/story68-release-live-font-command.test.mjs`](../../scripts/lib/story68-release-live-font-command.test.mjs)
- [`scripts/lib/story68-release-live-font.test.mjs`](../../scripts/lib/story68-release-live-font.test.mjs)
- [`scripts/lib/story68-save-tap.test.mjs`](../../scripts/lib/story68-save-tap.test.mjs)
- [`scripts/lib/story68-set-locale-tap.test.mjs`](../../scripts/lib/story68-set-locale-tap.test.mjs)
- [`scripts/lib/story68-talkback-composer-test-source.test.mjs`](../../scripts/lib/story68-talkback-composer-test-source.test.mjs)
- [`scripts/lib/story68-talkback-evidence.test.mjs`](../../scripts/lib/story68-talkback-evidence.test.mjs)
- [`scripts/lib/story68-talkback-failure.test.mjs`](../../scripts/lib/story68-talkback-failure.test.mjs)
- [`scripts/lib/story68-toggle-once-flow.test.mjs`](../../scripts/lib/story68-toggle-once-flow.test.mjs)
- [`scripts/lib/story68-watermark-budget.test.mjs`](../../scripts/lib/story68-watermark-budget.test.mjs)
- [`scripts/lib/story68-worklets-staging.test.mjs`](../../scripts/lib/story68-worklets-staging.test.mjs)
  They are named here by group.

Evidence boundaries:

- **Source-comment follow-up.**
  81 of the 81 linked source files in this test map lack a Step 48 cross-link comment in the reviewed Git snapshot.
  This document-only review leaves those source comments for a repository change.

- **Local review artifacts.**
  The cited `story-*` review records are retained locally under `_bmad-output/test-artifacts/` and ignored by Git.
  A fresh checkout can use the tracked story spec as the portable account of those findings.

- **Merged and done.**
  Story 6.8 merged as `67806196` (PR #162) on 2026-10-29, and `sprint-status.yaml` reads `done`.
- **The suite numbers are reported, and this step did not re-run them.**
  The spec records the final API gate at 4,934 tests across 320 files with 94.96/88.82/96.12/95.69 percent coverage, the iOS matrix at 30 cases, the Android matrix at 39 states, nine strict accessibility tests, and 30 local Chromium and WebKit browser cases.
- **Most run evidence lives outside git.**
  `_bmad-output/test-artifacts/story-6-8/` holds 856 local entries, including `verification-trace.md`, `review-font-three-facts.md` and `reviews/local-review-round1-triage.json`, and only three files under it are tracked on `main`.
- **Physical VoiceOver was not observed.**
  No physical iOS device was available; the strict XCUITest audit and UIKit focus observation are the approved substitute.
  Android uses real TalkBack on an emulator.
- **Live font-scale clipping is not fixed.**
  It is the pre-existing RN 0.81.5 Fabric issue and belongs to Story 6.15; the Release proof records an unchanged 92 px title.
- **Firefox does not launch locally on macOS.**
  Local browser proof covers Chromium and WebKit, and the CI lane requires all three engines.
- **Device lanes run on `main`, nightly and dispatch.**
  At `185e827c` the push run 41104845732 (2026-10-30, 13:12 CDT) passed every lane, including `ios-expo-go`.
  The nightly run 41189781880 on the same commit (2026-10-31, 04:42 CDT) failed `ios-shard (2)` and therefore `ios-evidence` and the gate; this step did not diagnose that failure.
- **The spec records two CI failures it could not explain.**
  The API 32 open-outfit failure and the API 36 web startup `curl` exit 22 did not reproduce locally; the harness now captures privacy-safe diagnostics for the next occurrence.

Architecture diagram:

```mermaid
flowchart TD
  Client["Web dialog or mobile composer"] --> Prepare["POST /api/v1/share-cards/prepare\npreview or save + expectedSha256"]
  Prepare --> Admit["ShareCardAdmission\n4 global, 1 per member\n15 s deadline"]
  Admit --> Resolve1["resolve source\nclosed projection"]
  Resolve1 -- "community post" --> Media["bounded download\n10 MiB, 5 s\nimage validation"]
  Resolve1 -- "outfit" --> Art["bundled category SVGs"]
  Media --> Render["ShareCardRenderer\ncatalog text + raw pixels\n5 s per Sharp stage"]
  Art --> Render
  Render --> Strip["stripShareCardMetadata\nIHDR, IDAT, IEND only"]
  Strip --> Resolve2["resolve source again\ncompare digest"]
  Resolve2 -- "changed" --> Stale["409 preview_changed\nRefresh preview"]
  Resolve2 -- "preview" --> Bytes["pngBase64 + sha256\nprivate, no-store"]
  Resolve2 -- "save" --> Audit["one transaction:\naudit row, then resolveGuarded"]
  Audit --> Bytes
  Bytes --> Web["web: Blob download\ncouturecast-card.png"]
  Bytes --> Owner["save-operation owner\ncommit before native call"]
  Owner --> Android["Android: MediaLibrary\nsaveToLibraryAsync"]
  Owner --> IOS["iOS: ShareCardPhotoSave\naddResource original PNG\nadd-only"]
```

## Step 49: Native platform sharing

User/business impact:

Step 48 lets a member preview and save a branded card, but getting it into Pinterest, Instagram, Facebook or TikTok still meant saving it and uploading it again.
This step adds Share beside Save in the mobile composer and the web dialog.
Share reauthorizes the exact previewed bytes and hands them to the OS share sheet on iOS and Android, or to the Web Share API in the browser.
Every outcome other than a handoff keeps the preview, the source and the watermark choice.
A stale-preview 409 focuses Refresh and disables Save and Share until a fresh preview loads.
Other failures keep Save available.
Each settled attempt makes one privacy-safe `share_card_shared` capture attempt.
Identity supersession suppresses the event, and a sanitizer failure drops it while preserving the share result.
Native share sits behind `share_card_native_share_enabled`, which defaults to false and is true only in the dev seed.

Key takeaways:

1. **One result model drives the UI, the analytics and the tests.**
   An attempt settles as `client` (ios, android, web), `target` (four allowlisted apps, other, none, unknown) and `outcome`, and only listed outcome-to-target pairs are valid.
   `completed` comes from iOS, `target_chosen` from the Android chooser callback, and `handed_off` from a resolved `navigator.share`.
   `none` means only that no target was confirmed.
   The spec makes this table the single policy for copy, focus, analytics and tests.
2. **Share reuses the save path on the server.**
   `purpose:'share'` requires `expectedSha256`, re-renders, compares digests and writes the same audit row with `purpose` added.
   `share` and `save` live in one strict variant with `purpose: z.enum(['save', 'share'])`, because a separate variant widened the published request union and Optic rejected it (`80782690`).
   With the flag off, a share prepare gets 403 `share_disabled` before any source, storage or render work and with no audit row.
3. **Add a capability endpoint when the old responses are strict.**
   The 6.8 preview and save response schemas are `.strict()`, so a new field would break deployed 6.8 clients.
   `GET /api/v1/share-cards/capabilities` returns `{data:{nativeShare:boolean}}` per member with `Cache-Control: private, no-store`.
   Clients treat a 5-second timeout, 404, malformed body or missing field as off, and drop a late answer for a previous member.
4. **Write a local native module when the library cannot report the result.**
   `expo-sharing` reports no target and no outcome, so `apps/mobile/modules/share-card-native-share/` owns both platforms.
   iOS presents a `UIActivityViewController` from the top-most controller on the main thread, anchored to the Share button's frame for the iPad popover.
   Android wraps one PNG send in a chooser whose callback `PendingIntent` is `FLAG_MUTABLE`, bound to the app's own package, with the attempt id in its action and a `RECEIVER_NOT_EXPORTED` receiver.
   The module returns only `{target, outcome, code?}`, and the JS validator in `share-card-share.native.ts` turns any other shape into `failed/none` with `invalid_result`.
5. **Settle Android with a first-event-wins state machine.**
   The chooser callback settles `target_chosen`.
   The host resuming plus a 750 ms grace with no callback, or host recreation or destruction, settles `not_confirmed`.
   A start error settles `failed`, or `unavailable` when no chooser resolves.
   A 5-second start deadline settles `not_confirmed` when the host never pauses at all.
6. **The handoff file lives on a lease, separate from the lock.**
   Each share writes `cache/share-cards/cc69-share-<uuid>/couturecast-card.png` and keeps it for 30 minutes by modification time, so the receiving app can still read it after the composer closes or the app restarts.
   One global native operation covers save and share and releases at settlement.
   The `cc68-` save sweep and the `cc69-share-` lease sweep match disjoint prefixes, and each platform's file validator accepts only its own prefix.
7. **Sanitize analytics at the SDK boundary and fail closed.**
   `before_send` on both PostHog SDKs keeps the transport envelope and allowlists only the four business keys, `locale`, and the SDK identity keys inside `properties`.
   It sets `$geoip_disable: true`, `$ip: null` and `$process_person_profile: false`, strips `$set`, URLs, screens and super properties, and returns null on any internal error.
   Wire tests read the actual serialized batch, including a deliberate sanitizer failure that must serialize zero share events.
8. **On web, call `navigator.share` inside the tap.**
   The dialog shows Share only when the capability is on and `navigator.canShare({files})` passes.
   The first tap runs the share prepare, stores a handoff authorization bound to identity, presentation key and digest for at most 60 seconds, and then calls `navigator.share`.
   When the tap's user activation expired during that prepare, the browser throws `NotAllowedError`; the attempt settles `failed` with `activation_expired`, shows the polite `shareTapAgain` prompt, and keeps the authorization.
   The next tap finds the authorization and calls `navigator.share` with nothing awaited before it.

Hard-won lessons from the implementation and code review of this story:

1. **A literal test count in CI broke when a test was added.**
   The `ios-build` guard grepped for `Executed 4 tests, with 0 failures`, and the new cross-prefix test made the photo-save suite five tests, which would have failed every iOS lane on `main` (Codex finding 1, V1).
   `cd02e875` parses the last XCTest summary under `pipefail` and requires a nonzero count with zero failures; `c760422c` also fails a run where every test was skipped.
2. **A weak reference let a refused share sheet hold the global lock.**
   When UIKit refuses `present()`, it drops the activity controller, and the module held it weakly, so the 10-second watchdog found nil and returned without settling (Codex finding 2, V2).
   `647a9518` moved the deadline into `ShareCardPresentationWatch`, which counts a released controller as refused, settles once, and dismisses a sheet that appears after the refusal.
3. **iOS 26 presents the activity sheet after a delay.**
   The presenter check read the delay as a refusal until `2be1b14b` waited for presentation.
4. **An Android host that never pauses never settled.**
   When the app was backgrounded during prepare, or Android blocked the background start, no callback, resume or destroy arrived, and the lock stayed held until process death (V3).
   `6ce37f92` added the 5-second start deadline.
5. **An unmounted composer cannot see an identity change.**
   A composer unmounted while the sheet was open kept a stale member epoch, so a late settlement emitted an event for a superseded member (Codex finding 3, V4); `6e3c9808` compared the live identity.
   Codex round 2 then showed a sign-out followed by the same member signing back in still passed that check (V17).
   `882b8c3e` added a process-level identity epoch in `setMobileApplicationUserId`, snapshotted at Share and compared at settlement and inside the deferred analytics import.
6. **Copy must claim only what the OS reported.**
   `sentToApp` said "Finish posting there" for Drive, Gmail and Files, and iOS `completed` into Copy or Print said "Shared" (V10); `1306ce5b` cut the claim to the handoff and maps iOS `completed/other` to `sentToApp`.
   An Android 15+ chooser result with no selected component, such as Copy or Edit, reported `other/target_chosen`; `bc32db6a` settles it as `not_confirmed/none`.
7. **The cache file name leaked into share sheets.**
   Sheet headers and Android receivers showed `cc69-share-<uuid>.png`.
   `032c0ced` set `LPLinkMetadata` titled `couturecast-card.png` and left `originalURL` unset, because iOS 26.1 showed the cache name as the header subtitle with it.
   Receivers that save by URL still got the cache name, so `4fd32dee` moved each handoff into its own `cc69-share-<uuid>/` directory with the file itself named `couturecast-card.png`.
8. **A web authorization meant for one tap outlived its attempt.**
   It survived `handed_off` and `dismissed`, so a second share within 60 seconds skipped the prepare, the flag check and the audit row (V5).
   `7552ec39` clears it on every result except `activation_expired`, and a 403 `share_disabled` now turns the capability off for that member on both clients (V13, `2c23e8ad`).
9. **A silent abort left "Sharing" on screen.**
   A mobile share that hit the 16-second request deadline returned an early `AbortError` (R1); `7fa049ba` settles it as `failed` with focus on Save.
10. **Share under Save pushed Cancel below the fold.**
    On an iPhone 17 Pro, Cancel ended at 887 of 874 pt, 63 pt past the 824-pt fold, and the stale and save-failure rows added 129 pt; on an iPhone SE, Share and Cancel were both off screen.
    On API 36 the resting composer fit by 4 px, but Try again pushed Cancel off screen, which failed the 6.8 `failure.yaml` flow in run 41179795488 on API 36 and API 32.
    `46a5c762` pairs Save with Share and the recovery action with Cancel in one row each, wraps to stacked buttons when labels do not fit, and gives the preview the remaining height down to a 240-pt floor.
    After it, Cancel ends at 822 of 824 pt on the iPhone 17 Pro and at 651 of 651 pt on the iPhone SE.
    `7043c033` makes every share-sheet step fail with `composer_action_below_fold` before and after its flow, so the next layout regression fails where it happens.
11. **A deadline-killed read hid the real Release font failure.**
    The same run failed `android36-interaction` with `release_font_native_command_failed`.
    At font scale 1.5 the stacked actions moved down 145 px, Cancel ended at 2436 on a 2400-px screen and dropped out of the Maestro hierarchy, and the last snapshot was killed by the remaining deadline.
    `c86b47ee` reports the last assessed state failure, `release_text_nodes_changed`, when the deadline cuts off a read, and logs the closed failure code to the job log.
12. **Sheet element ids differ between the local simulator and CI.**
    `ios-shard 1` in run 41179795488 runs an iPhone 16 Pro on iOS 18.5, while the Maestro flow's `ActivityListView` and `header.closeButton` ids came from a local iOS 26.1 simulator.
    The redacted screenshot showed the composer behind a sheet Maestro could not see, and no iOS 18 runtime installs on the local Xcode, so the failure could not be replayed.
    `37a00d33` moved M-SHARE-SHEET-IOS into `ShareCardShareSheetUITests`, which waits for the activity item and anchor reports, closes the sheet through the iOS 26 button, the iOS 17 and 18 header button or a drag, and checks for exactly one fresh leased file with the preview bytes.
    The CI-built client also showed that an app linked against the iOS 18 SDK gets no popover controller for the compact iPhone sheet, so the anchor check expects a zero rect there and leaves the real popover to the iPad proof.
13. **A warm Vite prebundle cache reloaded running tests.**
    Three mobile runs in a row failed with "Vite unexpectedly reloaded a test", each naming new dependencies.
    `c979eee5` forces the optimizer in run mode, so every run crawls its own entries as a cold CI checkout does: three cold runs passed 141 files and 1,824 tests in 104 to 110 seconds.
14. **The first test review scored the suite 40/100.**
    TEA's review of `f7024d48` found 12 HIGH findings: four test files past 1,000 lines, seven fixed 20 ms real-timer sleeps that proved absence by waiting, and a capability-privacy test that passed on any throw.
    It also listed gaps G01 to G38, including missing lease checks and device lanes that had never run on the branch.
    The automate pass split the files (`00b5725d`, `51648590`, `80d2124a`, `c7cf95cf`), replaced the sleeps with real settle signals, and closed gaps in separate commits such as `dcc30caa` (a test receiver app with its own UID observes the chooser read grant) and `57d8dd3d` (the iOS share item holds the previewed bytes).
15. **A stale device proof must fail.**
    `b555f8ff` requires the iPad anchor record's commit to be an ancestor of `HEAD` with no change since to the three anchor sources, and every native-harness job now checks out full history.
    The record was re-recorded at `7043c033` in `9570f663`.
16. **An owner request fixed an Android contrast bug outside the story.**
    The light-theme Android headers showed white status bar icons on white, because React Native's edge-to-edge setup never sets icon contrast, and the info modal header showed the raw route name "modal"; `a359d0d8` fixed both, with screenshots under `_bmad-output/test-artifacts/story-6-9/`.

Story/Task mapping:

- Story 6.9
- Task 1 (flag `share_card_native_share_enabled`, default false, seeded true)
- Task 2 (`share` purpose, capabilities contract and client, regenerated OpenAPI and SDK)
- Task 3 (API: `FeatureFlagsModule` import, capabilities route, share handled like save, 403 with no audit)
- Task 4 (Pact share and capabilities scenarios)
- Task 5 (`share_card_shared` strict schema with valid pairs and `duration_ms`)
- Task 6 (`before_send` allowlists on both PostHog SDKs)
- Task 7 (`share-card-native-share` module for iOS and Android)
- Task 8 (mobile share library, shared prepare-file helper, lease and sweep, fixture modes)
- Task 9 (composer Share action, anchor measurement, focus router, one event at settlement)
- Task 10 (web `canShare` gate, bounded handoff authorization, synchronous share)
- Task 11 (eight new keys in 20 locale files)
- Task 12 (tests for every test-design ID)
- Task 13 (`pr-share-native-unit.yml`)
- Task 14 (native lanes: `share-sheet` command, iOS shard 1, Android interaction, XCUITest presenter, iPad proof)
- Task 15 (Playwright Web Share cases)

Story reference:

- `_bmad-output/implementation-artifacts/spec-6-9-native-platform-sharing.md` on `feat/cc69-native-platform-sharing`, with the result model, edge rulings RG1 to RG6 and the review triage log V1 to V17
- `_bmad-output/implementation-artifacts/cc69-code-review-codex.md` (Codex rounds 1 and 2)
- `_bmad-output/test-artifacts/test-reviews/cc69-native-platform-sharing-test-review.md` (TEA test review and gaps G01 to G38)
- `_bmad-output/test-artifacts/test-design/cc69-native-platform-sharing-test-design.md`
- `_bmad-output/test-artifacts/story-6-9/README.md` and `ipad-anchor-proof.json`
- [PR #167](https://github.com/muratkeremozcan/couture-cast/pull/167), commits `185e827c..37a00d33`

Cross-links:

- Step 48 (Story 6.8) provides the prepare endpoint, the exact-byte preview, the save-operation owner, the composer and dialog, and the native harness this step extends.
- Step 8 provides the shared analytics registry the new event joins.
- Step 28 provides the focus and assistive-technology baseline behind the per-outcome focus rules.
- Step 22 provides catalog parity across ten locales.

Sequence to follow:

1. `packages/api-client/src/contracts/http/share-cards.ts` for the folded save/share variant and the capabilities schema.
2. `apps/api/src/modules/share-cards/share-cards.service.ts` and `share-cards.controller.ts` for the flag read, the 403 and the capabilities route.
3. `packages/api-client/src/types/analytics-events.ts` for `share_card_shared` and its valid pairs.
4. `apps/mobile/src/config/posthog.ts` and `apps/web/src/analytics/browser-analytics.ts` for the `before_send` sanitizers.
5. `apps/mobile/modules/share-card-native-share/ios/ShareCardNativeShareModule.swift`, `ShareCardShareFile.swift` and `ShareCardActivityItem.swift` for presentation, file validation and the public name.
6. `apps/mobile/modules/share-card-native-share/android/src/main/java/expo/modules/sharecardnativeshare/ShareCardShareSession.kt`, `ShareCardShareController.kt`, `ShareCardChooserIntent.kt` and `ShareCardFileProvider.kt` for the state machine, the chooser and the scoped provider.
7. `apps/mobile/src/lib/share-card-file.ts`, `share-card-share.native.ts` and `share-card-save-operations.ts` for the shared file helper, the lease, the validator and the global operation.
8. `apps/mobile/components/share-card-composer.tsx` for the Share action, the identity epoch and the paired action rows.
9. `apps/web/src/lib/share-cards.ts` and `apps/web/src/app/components/share-card-dialog.tsx` for `canShare` and the handoff authorization.
10. `scripts/lib/story69-share-sheet.mjs`, `scripts/ci/native-ios-shards.mjs` and `.github/workflows/pr-share-native-unit.yml` for how the proof runs.

Task owner map:

The Story 6.9 owner labels below are document navigation labels.
Source files on the reviewed branch still need the matching owner comments.

- Story 6.9 Task 2 step 1 owner: define the share purpose and capabilities contract in `packages/api-client/src/contracts/http/share-cards.ts`.
- Story 6.9 Task 3 step 1 owner: read the flag and refuse a disabled share in `apps/api/src/modules/share-cards/share-cards.service.ts`.
- Story 6.9 Task 5 step 1 owner: define `share_card_shared` in `packages/api-client/src/types/analytics-events.ts`.
- Story 6.9 Task 6 step 1 owner: sanitize mobile share events in `apps/mobile/src/config/posthog.ts`.
- Story 6.9 Task 6 step 2 owner: sanitize web share events in `apps/web/src/analytics/browser-analytics.ts`.
- Story 6.9 Task 7 step 1 owner: present and settle the iOS sheet in `apps/mobile/modules/share-card-native-share/ios/ShareCardNativeShareModule.swift`.
- Story 6.9 Task 7 step 2 owner: settle Android attempts in `apps/mobile/modules/share-card-native-share/android/src/main/java/expo/modules/sharecardnativeshare/ShareCardShareSession.kt`.
- Story 6.9 Task 8 step 1 owner: validate results and sweep leases in `apps/mobile/src/lib/share-card-share.native.ts`.
- Story 6.9 Task 9 step 1 owner: add Share to the composer in `apps/mobile/components/share-card-composer.tsx`.
- Story 6.9 Task 10 step 1 owner: gate and hand off Web Share in `apps/web/src/app/components/share-card-dialog.tsx`.
- Story 6.9 Task 14 step 1 owner: run the share-sheet proof in `scripts/lib/story69-share-sheet.mjs`.

Tests that cover this step:

These paths exist on `feat/cc69-native-platform-sharing` and reach `main` only when PR #167 merges.

API unit and integration tests:

- [`apps/api/src/modules/share-cards/share-cards.service.spec.ts`](../../apps/api/src/modules/share-cards/share-cards.service.spec.ts): proves share authorizes only the previewed digest and audits `purpose`, a refused share holds no admission slot, a changed digest or source returns 409 with no audit, an audit outage returns a closed 503, and preview and save are unchanged with the flag on or off.
- [`apps/api/src/modules/share-cards/share-cards.controller.spec.ts`](../../apps/api/src/modules/share-cards/share-cards.controller.spec.ts): proves share routing, the flag-off 403 envelope, the guarded capabilities GET with `private, no-store`, and that nothing beyond the boolean leaves.
- [`apps/api/src/modules/share-cards/share-cards.module.spec.ts`](../../apps/api/src/modules/share-cards/share-cards.module.spec.ts): compiles the real `ShareCardsModule` graph with `FeatureFlagsService`.
- [`apps/api/integration/share-card-share.integration.spec.ts`](../../apps/api/integration/share-card-share.integration.spec.ts): proves accepted shares and saves each write one row labelled with `purpose`, refused, stale and audit-failed shares write none, a down PostHog or false flag row refuses share, and both routes require authentication, against real PostgreSQL.

Shared contract and analytics tests:

- [`packages/api-client/testing/share-cards-contract.spec.ts`](../../packages/api-client/testing/share-cards-contract.spec.ts) and [`packages/api-client/testing/share-cards-client.spec.ts`](../../packages/api-client/testing/share-cards-client.spec.ts): prove the folded request variant and that the capabilities client resolves off on timeout, 404, malformed body or missing field.
- [`packages/api-client/testing/share-card-analytics.spec.ts`](../../packages/api-client/testing/share-card-analytics.spec.ts): proves the full outcome-to-target cross product and the forbidden keys.
- [`packages/config/src/flags.spec.ts`](../../packages/config/src/flags.spec.ts): proves the flag is registered and defaults to false.

Analytics boundary tests:

- [`apps/web/src/analytics/browser-analytics.test.ts`](../../apps/web/src/analytics/browser-analytics.test.ts) and [`apps/mobile/src/config/posthog.test.ts`](../../apps/mobile/src/config/posthog.test.ts): prove `before_send` keeps only allowlisted keys and returns null on internal error.
- [`apps/web/src/analytics/browser-analytics.wire.test.ts`](../../apps/web/src/analytics/browser-analytics.wire.test.ts) and [`apps/mobile/src/config/posthog.wire.test.ts`](../../apps/mobile/src/config/posthog.wire.test.ts): read the real SDK's serialized batch, including the deliberate sanitizer failure that serializes zero share events.
- [`apps/mobile/src/analytics/track-events.test.ts`](../../apps/mobile/src/analytics/track-events.test.ts): proves one capture with the four business keys, and that an invalid pair, a throw or a rejection is swallowed.

Mobile tests:

- [`apps/mobile/src/lib/share-card-share.native.spec.ts`](../../apps/mobile/src/lib/share-card-share.native.spec.ts): proves digest checks before handoff, the strict result validator, the lease sweep and the per-share directory.
- [`apps/mobile/src/lib/share-card-save-operations.spec.ts`](../../apps/mobile/src/lib/share-card-save-operations.spec.ts) and [`apps/mobile/src/lib/share-card-save.native.spec.ts`](../../apps/mobile/src/lib/share-card-save.native.spec.ts): prove one global operation for save and share, settlement cleanup that skips share files, and the `cc68-` sweep leaving `cc69-share-` alone.
- [`apps/mobile/src/lib/share-card-native-fixture.spec.ts`](../../apps/mobile/src/lib/share-card-native-fixture.spec.ts): proves the fixture modes per platform.
- [`apps/mobile/src/lib/mobile-auth.test.ts`](../../apps/mobile/src/lib/mobile-auth.test.ts): proves the process-level identity epoch advances on every change, sign-out included.
- [`apps/mobile/components/share-card-composer.share.test.tsx`](../../apps/mobile/components/share-card-composer.share.test.tsx) and [`apps/mobile/components/share-card-composer.analytics.test.tsx`](../../apps/mobile/components/share-card-composer.analytics.test.tsx): prove the capability gate, every outcome's copy and focus, one event per attempt, identity supersession after unmount, and the action layout fitting both iPhone viewports in every locale.
- [`apps/mobile/src/screens/root-layout-startup.test.tsx`](../../apps/mobile/src/screens/root-layout-startup.test.tsx): proves the root layout runs both startup sweeps.
- [`apps/mobile/src/i18n/share-card-locales.spec.ts`](../../apps/mobile/src/i18n/share-card-locales.spec.ts): proves the eight new keys in ten catalogs and denies published claims in handoff copy.

Web tests:

- [`apps/web/src/app/components/share-card-dialog.share.test.tsx`](../../apps/web/src/app/components/share-card-dialog.share.test.tsx): proves the `canShare` gate, the synchronous share inside the tap, `shareTapAgain`, the 60-second bound, per-attempt authorization and the `share_disabled` revocation.
- [`apps/web/src/lib/share-cards.test.ts`](../../apps/web/src/lib/share-cards.test.ts): proves the share prepare returns a File of the previewed bytes, different bytes read as a changed preview, `canShare` that is missing, false or throwing means unsupported, and capabilities fall back to off.
- [`apps/web/src/i18n/share-card-locales.spec.ts`](../../apps/web/src/i18n/share-card-locales.spec.ts): proves web catalog parity and the same published-claim denylist.

Native unit tests, run on pull requests by `pr-share-native-unit.yml`:

- [`apps/mobile/modules/share-card-native-share/ios/Tests/`](../../apps/mobile/modules/share-card-native-share/ios/Tests/): [`apps/mobile/modules/share-card-native-share/ios/Tests/ShareCardActivityTargetTests.swift`](../../apps/mobile/modules/share-card-native-share/ios/Tests/ShareCardActivityTargetTests.swift), [`apps/mobile/modules/share-card-native-share/ios/Tests/ShareCardShareOutcomeTests.swift`](../../apps/mobile/modules/share-card-native-share/ios/Tests/ShareCardShareOutcomeTests.swift), [`apps/mobile/modules/share-card-native-share/ios/Tests/ShareCardShareFileTests.swift`](../../apps/mobile/modules/share-card-native-share/ios/Tests/ShareCardShareFileTests.swift), [`apps/mobile/modules/share-card-native-share/ios/Tests/ShareCardShareMetadataTests.swift`](../../apps/mobile/modules/share-card-native-share/ios/Tests/ShareCardShareMetadataTests.swift), [`apps/mobile/modules/share-card-native-share/ios/Tests/ShareCardAnchorConfigurationTests.swift`](../../apps/mobile/modules/share-card-native-share/ios/Tests/ShareCardAnchorConfigurationTests.swift) and [`apps/mobile/modules/share-card-native-share/ios/Tests/ShareCardPresentationWatchTests.swift`](../../apps/mobile/modules/share-card-native-share/ios/Tests/ShareCardPresentationWatchTests.swift) prove the target mapper, outcome mapping, `cc69-share-` file rule, public name, anchor configuration and the refused-presentation settlement.
- [`apps/mobile/modules/share-card-photo-save/ios/Tests/ShareCardPhotoSaveTests.swift`](../../apps/mobile/modules/share-card-photo-save/ios/Tests/ShareCardPhotoSaveTests.swift): proves the photo-save validator rejects `cc69-share-` files.
- [`apps/mobile/modules/share-card-native-share/android/src/test/java/expo/modules/sharecardnativeshare/`](../../apps/mobile/modules/share-card-native-share/android/src/test/java/expo/modules/sharecardnativeshare/): [`apps/mobile/modules/share-card-native-share/android/src/test/java/expo/modules/sharecardnativeshare/ShareCardTargetMapperTest.kt`](../../apps/mobile/modules/share-card-native-share/android/src/test/java/expo/modules/sharecardnativeshare/ShareCardTargetMapperTest.kt), [`apps/mobile/modules/share-card-native-share/android/src/test/java/expo/modules/sharecardnativeshare/ShareCardShareResultTest.kt`](../../apps/mobile/modules/share-card-native-share/android/src/test/java/expo/modules/sharecardnativeshare/ShareCardShareResultTest.kt), [`apps/mobile/modules/share-card-native-share/android/src/test/java/expo/modules/sharecardnativeshare/ShareCardPendingIntentTest.kt`](../../apps/mobile/modules/share-card-native-share/android/src/test/java/expo/modules/sharecardnativeshare/ShareCardPendingIntentTest.kt) (SDK 34 and 36), [`apps/mobile/modules/share-card-native-share/android/src/test/java/expo/modules/sharecardnativeshare/ShareCardFileProviderTest.kt`](../../apps/mobile/modules/share-card-native-share/android/src/test/java/expo/modules/sharecardnativeshare/ShareCardFileProviderTest.kt), [`apps/mobile/modules/share-card-native-share/android/src/test/java/expo/modules/sharecardnativeshare/ShareCardShareFilesTest.kt`](../../apps/mobile/modules/share-card-native-share/android/src/test/java/expo/modules/sharecardnativeshare/ShareCardShareFilesTest.kt) and [`apps/mobile/modules/share-card-native-share/android/src/test/java/expo/modules/sharecardnativeshare/ShareCardHostLifecycleTest.kt`](../../apps/mobile/modules/share-card-native-share/android/src/test/java/expo/modules/sharecardnativeshare/ShareCardHostLifecycleTest.kt) prove the package mapper, the state machine with its 750 ms grace and teardown, the package-bound `PendingIntent`, the scoped provider and the lifecycle bridge under Robolectric.

Device tests, run on `main`, nightly and dispatch:

- [`apps/mobile/native-tests/ShareCardShareSheetUITests.swift`](../../apps/mobile/native-tests/ShareCardShareSheetUITests.swift): presents the real iOS sheet, checks the anchor and the shared item's digest, closes the sheet and checks one fresh leased file; a failed share moves focus to Save.
- [`apps/mobile/modules/share-card-native-share/android/src/androidTest/java/expo/modules/sharecardnativeshare/ShareCardShareReceiveTest.kt`](../../apps/mobile/modules/share-card-native-share/android/src/androidTest/java/expo/modules/sharecardnativeshare/ShareCardShareReceiveTest.kt): a receiving app with its own UID reads the granted URI with the previewed digest, and sibling and out-of-scope URIs are denied.
- [`maestro/story68/share-chosen.yaml`](../../maestro/story68/share-chosen.yaml), [`maestro/story68/share-closed.yaml`](../../maestro/story68/share-closed.yaml), [`maestro/story68/share-completed.yaml`](../../maestro/story68/share-completed.yaml), [`maestro/story68/share-failed.yaml`](../../maestro/story68/share-failed.yaml), [`maestro/story68/share-not-confirmed.yaml`](../../maestro/story68/share-not-confirmed.yaml), [`maestro/story68/share-other.yaml`](../../maestro/story68/share-other.yaml), [`maestro/story68/share-unavailable.yaml`](../../maestro/story68/share-unavailable.yaml) and [`maestro/story68/share-sheet.yaml`](../../maestro/story68/share-sheet.yaml) (Android branch only since `37a00d33`): the fixture outcomes, the lease after relaunch, and the real Android chooser.

Pact and Playwright tests:

- [`pact/http/consumer/interactions/share-cards.ts`](../../pact/http/consumer/interactions/share-cards.ts): share and capabilities interactions for old and new clients and servers.
- [`playwright/tests/share-card-native-share.spec.ts`](../../playwright/tests/share-card-native-share.spec.ts): five Web Share cases with `share` and `canShare` stubbed per engine: bytes, tap again, dismiss, capability off and revalidation.

Harness tests:

- [`scripts/lib/story69-share-sheet.test.mjs`](../../scripts/lib/story69-share-sheet.test.mjs), [`scripts/lib/story69-ipad-evidence.test.mjs`](../../scripts/lib/story69-ipad-evidence.test.mjs), [`scripts/lib/story68-native-safety.test.mjs`](../../scripts/lib/story68-native-safety.test.mjs), [`scripts/ci/native-ios-shards.test.mjs`](../../scripts/ci/native-ios-shards.test.mjs), [`scripts/ci/share-card-android.test.mjs`](../../scripts/ci/share-card-android.test.mjs) and [`scripts/ci/share-card-lanes.test.mjs`](../../scripts/ci/share-card-lanes.test.mjs): prove the share-sheet plan and markers, the below-fold check, iPad proof staleness, the log privacy scan over shipped sources, `share-sheet` exactly once in iOS shard 1, and the PR unit lane's zero-test guards.

Evidence boundaries:

- **Source-comment follow-up.**
  56 of the 56 linked source files in this test map lack a Step 49 cross-link comment in the reviewed Git snapshot.
  This document-only review leaves those source comments for a repository change.

- **Unmerged and still in CI.**
  PR #167 is open with head `37a00d33` on `origin`.
  The branch's `sprint-status.yaml` reads `review`, and `main` still reads `backlog`.
  This step describes `origin` at `37a00d33`.
  The reviewed snapshot excludes later local commits, including `e2d9fa18` and `0b307a7e`, and uncommitted work.
  The local checkout is active, so the number of unpushed commits can change during this review.
- **The pull request checks pass, and the device lanes do not yet.**
  On `37a00d33` every PR job passed and the PR `gate` reported 49 watched jobs green; the slowest were burn-in at 18m5s and browser-acceptance at 15m35s, inside the 20-minute PR budget.
  The [dispatch run 41190704639](https://github.com/muratkeremozcan/couture-cast/actions/runs/41190704639) on the same commit passed both iOS shards, `ios-expo-go`, `android36-interaction`, `android36-original` and `original-resource`, but `android36-native-matrix` timed out at its 60-minute step limit, so `share-card-lanes-gate` failed at 06:30 CDT on 2026-10-31.
  This step did not diagnose that timeout.
- **The reviews have open items.**
  Codex round 2 resolved findings 1 and 2 and left finding 3 partly open; `882b8c3e` addresses it, and no third Codex round is committed.
  The TEA review's 40/100 score is for `f7024d48`; no re-scored review is committed.
- **Some things only a device can prove.**
  X-SHARE-DEVICE-PIN, -IG and -FB-TT need physical devices with Pinterest, Instagram, Facebook and TikTok installed, and the test design requires them before the flag is enabled beyond the dev seed; none is recorded.
  The iPad anchor proof is an iPadOS 26.1 simulator at `7043c033`; a physical iPad popover is unproven.
  No lane reads the bytes a third-party iOS share extension receives, and the file name Files or AirDrop shows was not checked on a device.
- **Counts here come from commit bodies and reviews.**
  The 1,205 tests the TEA review executed, the 141 files and 1,824 mobile tests in `c979eee5`, and the layout measurements in `46a5c762` are reported, and this step did not re-run them.
- **Known gaps outside the story.**
  Android dark mode leaves the tab header title near-black on the dark header and the feed filter band white.
  Firefox does not launch locally on this Mac, so local browser proof covers Chromium and WebKit and CI runs all three.
- **Production stays dark.**
  `share_card_native_share_enabled` defaults to false and is true only in the dev seed.

Architecture diagram:

```mermaid
flowchart TD
  Cap["GET /share-cards/capabilities\nnativeShare per member\nerror means off"] --> Tap["Share tap\nduplicate guard"]
  Tap --> Prep["POST prepare purpose share\nexpectedSha256"]
  Prep --> Flag{"flag on?"}
  Flag -- "no" --> Deny["403 share_disabled\nno audit, Share hidden"]
  Flag -- "yes" --> Same["Step 48 path:\nre-render, compare digest,\naudit row with purpose"]
  Same -- "changed" --> Stale["409 preview_changed\nfocus Refresh"]
  Same -- "same bytes" --> Fork{"client"}
  Fork -- "iOS or Android" --> File["cc69-share-uuid/couturecast-card.png\n30-minute lease\nglobal save/share operation"]
  File --> IOS["UIActivityViewController\nanchored to Share\ncompleted or cancelled"]
  File --> AND["chooser + package-bound PendingIntent\ncallback, resume + 750 ms grace,\n5 s start deadline"]
  Fork -- "web" --> Auth["handoff authorization\n60 s, identity + presentation + digest"]
  Auth --> WS["navigator.share in the tap\nhanded_off or dismissed"]
  IOS --> Settle["validated settlement\ntarget + outcome + code"]
  AND --> Settle
  WS --> Settle
  Settle --> UI["copy and focus per outcome\npreview and Save kept on non-success"]
  Settle --> Epoch{"identity epoch unchanged?"}
  Epoch -- "yes" --> Event["share_card_shared\nbefore_send allowlist\n$ip null, no person profile"]
  Epoch -- "no" --> Drop["no event"]
```

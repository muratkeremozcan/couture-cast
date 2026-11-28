---
title: 'Story CC-7.23: AI-written look ideas'
type: feature
ticket: '7-23-ai-written-look-ideas'
created: '2026-11-27'
status: built
baseline_revision: '3713df073a04a512580afd8336c3cda87899f592'
route: full
route_source: auto
risk: high
review: thorough
review_source: pinned
lenses_ran:
  - 'independent-correctness'
  - 'codex-security'
review_loop_iteration: 1
context:
  - '_bmad-output/planning-artifacts/epics.md'
  - '_bmad-output/implementation-artifacts/epic-7-context.md'
  - '_bmad-output/test-artifacts/test-design-7-23-ai-written-look-ideas.md'
---

<frozen-after-approval>

## Intent

Members can open Looks > Ideas and see a complete catalog outfit within one second. The
stylist describes and ranks the weather-eligible outfits while the member can edit and save.

## Boundaries & Constraints

- The server sends enumerated style choices, coarse weather and server-selected sample catalog
  IDs. The request body and output stay out of logs and captured fixtures. Only aggregate
  outcome and elapsed time describe generation.
- The rule-based selector owns every piece and slot. The model can rank those selections and
  write bounded descriptions about the clothes and weather using approved language. The
  grammar excludes statements about the member, including body, age, identity and appearance.
- Existing authentication and guardian checks apply to generation. The local catalog flow
  stays available for guardian-pending members. Today keeps the rule-based outfit.
- CC-7.24 owns photo AI. The provider receives text only.

## I/O & Edge-Case Matrix

| Scenario                             | Inputs or state                                                         | Member experience                                                                  |
| ------------------------------------ | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Untouched editor                     | Valid ranking for the current request                                   | Top-ranked idea and its description appear.                                        |
| Member interacts or restores a draft | Valid ranking arrives                                                   | New ideas ready appears. Applying it preserves the selected mood, pieces and pins. |
| Stale result                         | Weather, preferences, session or account changed                        | The old result cannot change the editor or show a notice.                          |
| Unavailable result                   | Disabled, timeout, failed provider, rejected output or exhausted budget | The rule-based editor stays usable.                                                |

</frozen-after-approval>

## Code Map

- `packages/api-client/src/contracts/http/look-ideas.ts` defines the strict authenticated
  POST contract, with a nullable ranking. Regenerate the OpenAPI document and SDK.
- `apps/api/src/modules/personalization/look-ideas.*` owns prompt, dispatch, validation,
  deadline and atomic quota. The database holds a deleted-with-account daily counter and one
  cumulative dispatch count. `apps/api/src/logger/` strips account context on this route.
- `packages/utils/src/sample-wardrobe/member-lookbook*` owns eligibility, copy and
  ranking application. Both existing Ideas editors share the asynchronous result logic and
  use their existing account-scoped API clients and draft stores.

## Tasks & Acceptance

- [x] Add the typed route, provider and persistent pre-dispatch limits.
- [x] Wire safe and session-scoped ranking and descriptions to web and native Ideas.
- [x] Add acceptance coverage, address the full review and link Step 80.

- Given a member opens Ideas, when generation is pending, then a complete rule-based look
  is visible within one second.
- Given the provider returns a complete ranking for the current untouched editor, when
  validation succeeds, then the highest-ranked idea appears. After interaction, the same
  result waits for New ideas ready and applying it preserves the current composition.
- Given a stale response, invalid IDs or language, timeout, provider error or exhausted
  quota, when the response settles, then the current look and pins remain available.
- Given 20 sequential synthetic valid calls, when CI measures server generation, then
  nearest-rank p95 is at most five seconds and the lane makes zero live calls.

## Design Notes

- Vercel AI Gateway routes to Anthropic Claude Haiku 5.5, pinned as
  `anthropic/claude-haiku-5.5`. Anthropic documents the dateless model ID as a fixed
  snapshot. Use one allowed provider and request-level zero data retention. Vercel says
  the gateway discards prompt and output after inference and routes only to partners with
  negotiated zero-retention terms when requested. The requested policy includes no
  prompt training. Anthropic describes misuse and legal exceptions and retained safety
  classifier results in its zero-retention terms.
  [Gateway model](https://vercel.com/ai-gateway/models/anthropic/claude-haiku-5.5)
  [Model versioning](https://platform.claude.com/docs/en/about-claude/models/model-ids-and-versions)
  [Gateway retention and training](https://vercel.com/blog/zdr-on-ai-gateway)
  [Anthropic retention](https://privacy.claude.com/en/articles/8956058-i-have-a-zero-data-retention-agreement-with-anthropic-what-products-does-it-apply-to)
- At published prompt-under-100K rates of $0.10 per million input tokens and $0.50 per
  million output tokens, 1,000 input and 400 output tokens cost about $0.0003 per call.
  Limit output to 400 tokens. Reserve $0.01 before each dispatch against a cumulative
  $5 app cap (500 calls) and a per-account quota of three calls per UTC day. A dispatched
  timeout keeps its reservation. Provider and accounting share a five-second deadline.
  [Anthropic pricing](https://platform.claude.com/docs/en/about-claude/pricing)
- Customer rollout requires separate owner approval and an explicit server switch.
  Confirmation that the existing Gateway route qualifies for per-request zero retention
  is part of that decision. Any change to paid plans, credit purchases or account settings
  is a separate owner decision. A single local synthetic smoke call may use an existing key.
  [Gateway policy eligibility](https://vercel.com/i/openai-compatible-api)

## Implementation Notes

- Shared worktree protocol: TEA owns the test plan, all new tests and CI fixes. Leave
  those files unstaged. Builder owns production code and npm ci, which has completed.
  Keep implementation changes unstaged. CI runs all suites. Local verification uses
  Node 24.22.3 for generated contracts, lint and touched workspace type checks.
- TEA's fixture contract is POST `/api/v1/personalization/look-ideas` with
  `{weather, profile}` and `{data: [{lookId, description}, ...] | null}`. Preserve the
  client profile's null or null-field-object shape absent a day override. Export
  LookIdeasController, LookIdeasService with `generate(userId, input)`,
  LOOK_IDEA_PROVIDER with `generate(input, signal)`, and LOOK_IDEA_BUDGET with
  `reserve(userId)` from their separate files under personalization. Provider input has
  `candidates` entries `{lookId, pieces}`; provider output is `{ideas: [{lookId, description}]}`.
  Budget outcomes are allowed, account_limit, spend_limit and unavailable. The concrete
  implementation is DatabaseLookIdeaBudget. Emit `look_ideas_generation` via the API's
  base logger with outcome and durationMs. Remove account ID from generic access/error
  telemetry for this route too.
- Web and native use test IDs `lookbook-new-ideas` (New ideas ready) and
  `lookbook-ai-description`. Accept synthetic descriptions such as
  "A polished mix for the day." through a closed grammar of safe garments-only language.
  The ranking response contains only IDs selected in this request. Account switching,
  input changes and unmounts fence both automatic and explicit application. Keep the
  rule-based first paint independent of auth profile/weather network latency.
- Live dispatch requires an explicit `LOOK_IDEAS_ENABLED=true` switch and the existing
  server-only `AI_GATEWAY_API_KEY` or `VERCEL_OIDC_TOKEN`. Disable live dispatch in CI,
  test and Vercel preview. Use a fixed Gateway URL and provider allowlist with
  request-level zero data retention. Keep local smoke and provider account settings with
  the builder. The SQL budget must be atomic, durable and fail closed.
- For this route, verify the current teen account status directly. The general guardian
  policy can allow pending accounts into the app. Pending accounts keep the rule-based editor
  and their style choices stay within CoutureCast.
- Local smoke skipped. The worktree and available development environment supplied no
  AI Gateway credential or linked Vercel project.

## Plan Change Log

## Review Triage Log

Independent review and Codex Security inspected base
`3713df073a04a512580afd8336c3cda87899f592` and head
`063e9fd6e7e5775e2582137f6cf73d60778a54b3`. The security scan accounted for all
47 changed paths. Its one reportable finding is P2-1 below.

| Finding                          | Resolution                                                                                                                                                      |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1-1 Shared coverage             | Exercise ranking inputs, subscription, cleanup, fallback and presentation in the utils lane.                                                                    |
| P1-2 Client coverage             | Exercise wire parsing, auth, cancellation and generated contract registration in the API client lane.                                                           |
| P1-3 App and privacy coverage    | Add default MSW fallbacks and extend API and web acceptance to exercise edits and privacy.                                                                      |
| P2-1 Active teen and log privacy | Apply the active-teen rule by handler metadata and classify private HTTP logging by Express pathname. Sanitize structural HTTP errors before Nest can log them. |
| P2-2 Gateway authentication      | Resolve the deployment credential at use time so a rotated token can be picked up.                                                                              |
| P2-3 Production telemetry        | Default the aggregate generation logger to info in production, subject to explicit log configuration.                                                           |
| P2-4 Quota timeout               | Share one absolute deadline and abort signal with quota accounting and provider dispatch.                                                                       |
| P2-5 Gateway response            | Limit the declared and streamed response size to 32 KiB before JSON parsing.                                                                                    |
| P2-6 Database privacy            | Verify both tables in the RLS matrix and exercise per-account quota erasure.                                                                                    |
| P3-1 Closeout                    | Mark the story built, set sprint status to done and link the acceptance evidence from Step 80.                                                                  |
| P3-2 Eligibility availability    | Return a sanitized 503 when the active-teen lookup fails.                                                                                                       |

CodeRabbit's single round found that generated OpenAPI omitted the ranking length constraint.
The shared schema now publishes a minimum and maximum of three and still allows a null fallback.

## Verification

Run type checks and targeted lint locally. The
[TEA test plan](../test-artifacts/test-design-7-23-ai-written-look-ideas.md) defines
fixture-backed API, web and native evidence. Verify every workflow at the final PR head.

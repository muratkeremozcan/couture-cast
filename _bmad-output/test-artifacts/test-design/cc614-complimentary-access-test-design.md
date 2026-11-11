---
runScope: 'epic'
runKey: 'epic-6-story-6.14'
workflowStatus: 'complete'
totalSteps: 5
stepsCompleted:
  [
    'step-01-detect-mode',
    'step-02-load-context',
    'step-03-risk-and-testability',
    'step-04-coverage-plan',
    'step-05-generate-output',
  ]
lastStep: 'step-05-generate-output'
nextStep: ''
lastSaved: '2026-11-10'
---

# Test Design: Epic 6, Story CC-6.14 Complimentary full access

**Date:** 2026-11-10
**Author:** Murat (TEA), peer review for the builder in herdr pane `wY:p1`
**Status:** Planned. No test is written yet.

**Precedence:** the spec at `_bmad-output/implementation-artifacts/spec-6-14-complimentary-full-access.md` wins wherever this document and the spec disagree.
The frozen block is unchanged by TEA.
Findings that change a frozen decision are marked (intent) in the spec's Plan Change Log, and the builder applies them.

Inputs read at baseline `63bd6fcd`:

- The spec draft, `epic-6-context.md` by reference, and the 6.13 spec and test design for shape.
- Code: `feature-flags.service.ts`, `community-flag-evaluation.service.ts`, `community-send-guard.ts`, `community.service.ts` (`readAuthorized`, `assertFlagEnabled`), `premium-entitlement.service.ts`, `premium-entitlement.guard.ts`, `stripe-billing.service.ts`, `community-sponsorship-operator.service.ts`, `community-sponsorship.cli.ts`, `community.repository.ts` (`requestAccountErasure`), `community-engagement.runtime.ts`, `workers/bootstrap.ts`, `workers/community.bootstrap.ts`, `realtime/community-realtime.server.ts`, `posthog.service.ts`, `packages/config/src/flags.ts`, the `20261020120000_community_realtime` migration, the E2E start scripts, `pact/http/consumer/interactions/commerce-subscription.ts`, web `subscription-section.tsx`, mobile `premium.ts`.
- Knowledge: `probability-impact.md`, `test-priorities-matrix.md`, `test-levels-framework.md`, `library-integration-mandate.md`, `playwright-utils-mandate.md`, `pactjs-utils-mandate.md`. Both library flags are true and both packages are installed (`@seontechnologies/playwright-utils` 4.4.1, `@seontechnologies/pactjs-utils` 1.1.0).

---

## Spec review: findings against the real code

Each finding is recorded as TEA-NN in the spec's Plan Change Log with the proposed fix.
The evidence is here.

**TEA-01 (intent, D4). Nulling the cache value blocks the grantee and leaks a revoke.**
`CommunityFlagEvaluationService.claim` (`community-flag-evaluation.service.ts:214-222`) only claims a row whose `next_claim_at <= clock_timestamp()` and whose lease is free.
Every claim pushes `next_claim_at` 45 seconds ahead.
Setting only `remote_value` and `expires_at` to null leaves both in place, so the grantee's next request reads an invalid row, cannot claim it, and `resolve` throws `CommunityUnavailableException` for up to 45 seconds after the grant.
A refresh already in flight keeps its `refresh_owner`, and its guarded `UPDATE` (`:291-298`) then writes the answer it computed before the grant or revoke, valid for 60 seconds.
After a revoke, that is 60 seconds of feed, realtime and push for a member whose grant is gone.
The fix: grant and revoke `DELETE` the member's `CommunityFlagEvaluation` rows, as `community_forget_subject` already does (migration `20261020120000`, line 475), after `community_privacy_guards(ARRAY[member], ARRAY[]::text[], false)`.
The in-flight `UPDATE` then matches no row, and the next request inserts a fresh row whose `next_claim_at` defaults to now.

**TEA-02 (intent, D4). One answer for `community_read_enabled`.**
D4 puts all six flags behind a shortcut at the top of `FeatureFlagsService.getFeatureFlag`.
For `community_read_enabled` that answers before `communityReadEvaluation`, while `readAuthorized`, realtime and the send guard read the cache.
After a revoke or a kill-switch flip the comments paths (`community-comments.service.ts:63`, `community-comments.processor.ts:204`) and the feed would disagree for up to 60 seconds.
The fix: `community_read_enabled` stays out of the generic shortcut and reaches the override only through the cache (TEA-01) and the fixture branch (TEA-03).
`COMPLIMENTARY_MEMBER_FLAGS` keeps all six names; the shortcut applies to the five others.

**TEA-03 (intent, D4). The fixture branch skips the cache.**
`communityReadEvaluation` (`feature-flags.service.ts:63-80`) reads the global `FeatureFlag` row directly when `TEST_ENV=local`, `COMMUNITY_FLAG_FIXTURE_MODE=true` and the database is on loopback.
Every E2E stack sets that mode (`scripts/start-api-e2e-with-workers.mjs:70`, `scripts/e2e-share-card/prepare.mjs:129`, `scripts/e2e-real-session/run.mjs:446`), and so does k6.
Without the override there, every E2E grantee with the flag off gets 403 and the story's E2E cannot pass.
The fix: the fixture branch asks `isActive` first and returns a true grant when it answers true.

**TEA-04 (intent, D2, D3). Read order, bounded reads and one global kill-switch subject.**
`isActive` reads the grant row first and evaluates the kill switch only when a grant exists, so a member with no grant pays one indexed read and no PostHog call.
The kill switch is evaluated for one fixed system subject, `complimentary-access-kill-switch`.
It is global by purpose, a per-member rule in PostHog would silently split it, and the member id has no reason to reach PostHog for it.
Inside the community refresh, the grant read runs under `budget.connection` and the kill-switch read uses the refresh's invocation signal.
The refresh must invoke within one second of its claim (`invokeBy`, `:255`), and the SDK path `getFeatureFlagValue` without a signal (`posthog.service.ts:161`) has no deadline of its own.
A timeout or error on either read counts as no grant, logs `complimentary_access_unavailable`, and falls through to the remote call as today.
Elsewhere the kill switch resolves through the shared resolver (remote, `FeatureFlag` row, code default `true`) with a 500 ms remote deadline.

**TEA-05 (intent, D2). Hand-built services and a dependency cycle.**
`CommunityFlagEvaluationService` is built by hand at `community-engagement.runtime.ts:140`, `workers/bootstrap.ts:320` and `:346`, and `workers/community.bootstrap.ts:144`, and in the integration support files `community-flag-instance.mjs:31`, `community-engagement-worker.mjs:86` and `helpers/community-engagement-harness.ts:194`.
`PremiumEntitlementService` is built by hand at `workers/bootstrap.ts:228`.
The production push sender is the `community.bootstrap.ts` instance, so a site that misses the new dependency silently ignores every grant for push.
`ComplimentaryAccessService` cannot inject `FeatureFlagsService`, because `FeatureFlagsService` already injects `CommunityFlagEvaluationService`.
The fix: `ComplimentaryAccessService` depends on `PrismaClient` and the remote provider, resolves the kill switch through `@couture/config`'s resolver with the `FeatureFlag` row as fallback, and is a required constructor argument everywhere, so `tsc` finds every site.

**TEA-06 (I/O matrix). The revoked feed answers 403.**
`readAuthorized` (`community.service.ts:428-433`) throws 403 `{code:'denied'}` when the grant is false.
Write paths answer 503 through `assertFlagEnabled` (`:463-466`).
The matrix rows "Revoke, free member" and "Kill switch off" should read "feed 403 `denied`, posting 503".

**TEA-07 (intent, D5). Checkout order and the mobile purchase path.**
`createCheckoutSession` (`stripe-billing.service.ts:76-87`) checks the purchasing flag first, so in production, where `commerce_subscription_enabled` is false, a grantee gets 503 before any 409.
Keep that order. The complimentary 409 goes after the existing paid-active 409, and the matrix row holds with purchasing on.
The refusal follows the `SUBSCRIPTION_ALREADY_ACTIVE_MESSAGE` envelope, and web `premiumFailureReason` maps it.
Mobile buys through the RevenueCat SDK on the device (`apps/mobile/src/lib/premium.ts:342`), which the server cannot refuse.
Mobile settings hide the purchase controls when `source` is `complimentary`, and the spec states the residual: a grantee who reaches a store purchase some other way is charged by the store.

**TEA-08 (intent, D7). Refusal codes and targeting from the operator pattern.**
`resolveAdminActor` (`community-sponsorship-operator.service.ts:325-367`) refuses with `actor_auth_user_missing`, `actor_not_admin`, `actor_app_user_missing` and `actor_identity_mismatch`.
D7 lists `actor_not_found`, which it never produces.
Extracting the helper must keep the sponsorship command's codes byte-identical, because its specs assert them.
The closed list becomes those four plus `member_not_found`, `member_erasure_requested`, `already_granted`, `no_active_grant` and `invalid_reason`.
The 6.7b CLI also carries targeting the D7 command line omits: `--env-file` is the only source of `DATABASE_URL`, a non-loopback host needs `--confirm-target <project ref>`, `--dry-run` writes nothing, and the exit codes are 0, 1 and 2.
Copy all of it.

**TEA-09 (intent, D7, D8). Grant racing erasure.**
`requestAccountErasure` (`community.repository.ts:613-675`) serializes on the subject guard and the `community_member:` advisory lock.
A grant that checks `ModerationErasureRequest` without those locks can read "no request", lose the race to the erasure's `DELETE`, and then insert a row that outlives the request.
The fix: the grant takes the same guard and lock in the erasure's order before it reads the request row, and runs in `communityPrivacyTransaction`.

**TEA-10 (D7). Concurrent writes.**
Two grants at once: the partial unique index raises, and the loser answers `already_granted` with no audit row, never a stack trace.
Two revokes at once: the `UPDATE ... WHERE revoked_at IS NULL` count decides, and the loser answers `no_active_grant` with no audit row.

**TEA-11 (intent, D1, D8). Erasing a granter or revoker.**
6.13 TEA-12 set the rule that no member identity stays in a record after the erasure request, except the row the `User` delete removes.
`granted_by_id` and `revoked_by_id` keep an erased admin's id for 72 hours under D8 as written.
The fix: `requestAccountErasure` nulls both where they name the member, in the same transaction.
The D1 check becomes `CHECK ((revoked_at IS NULL) = (revoke_reason IS NULL) AND (revoked_at IS NOT NULL OR revoked_by_id IS NULL))`, and `list` prints `[erased]` for a null granter.

**TEA-12 (D3, D10). The kill switch is not instant for community.**
A kill-switch flip cannot reach cached rows. A grantee's `community_read_enabled` row stays valid until its `expires_at`, at most 60 seconds, and the send guard reads that row.
D3's "Off removes every complimentary effect at once" becomes: premium and the five shortcut flags on the next request, community read, realtime and push within 60 seconds.
The deployment guide's incident rule says so.

**TEA-13 (D4). Operator paths that read `community_write_enabled` for a subject.**
`moderation-decisions.service.ts:303` (`writesOpenFor(subject)`), `community-moderation.actions.ts:101` (`releaseFlaggedPost` by the author) and `community-moderation.processor.ts:570` evaluate the flag for the author.
With the override, decisions and releases on a grantee's case are open while other authors' stay closed.
That matches what the flag means, and the spec says so in D4.
Tests prove both sides.

**TEA-14 (D6). Client states with two reads.**
When `premium/access` fails, clients render the subscription section exactly as today and never show the complimentary state.
When a member is both paid and complimentary, clients show the complimentary note and the subscription block with its portal link.
When `source` is `complimentary`, no subscribe or purchase control renders on either client.

**TEA-15 (Boundaries). "Flags off globally" needs its own E2E runtime.**
Every E2E stack seeds the six flags true, and local runs execute specs in parallel against one database.
Flipping global rows inside the shared run breaks the community, premium and share-card specs running beside it.
The complimentary E2E runs on its own owned runtime, the `scripts/e2e-share-card/prepare.mjs` and `playwright/support/share-card-owned-runtime.ts` pattern, with an isolated `DATABASE_URL`, `PLAYWRIGHT_SKIP_DB_RESET=true`, the six flag rows false, no PostHog key and one worker.
A non-grantee control in the same run must see the locked and denied states, which proves the override passed and the seed did not.
Its CI job stays under 20 minutes.

**TEA-16 (D2, D5). Non-grantees pay as little as possible.**
`hasPremiumAccess` reads the paid row first and asks `isActive` only when the row does not entitle.
`getFeatureFlag` reads grants only for the five shortcut keys.
One indexed read on the partial unique index per call.

**TEA-17 (D9). Turning on production dispatch.**
Rows queued while dispatch was off get processed after the flip.
Expired groups become `expired`, but every pending delivery costs one per-member PostHog evaluation and a send-guard pass.
Before setting `COMMUNITY_DISPATCH_ENABLED=true`, run a read-only count of `CommunityTokenDelivery` by status and expiry and record the number in the guide.
After the flip, confirm `community_dispatch_readiness` logs `ready` and that a non-grantee test account's delivery ends `suppressed` with `no_call:read_disabled`.

**TEA-18 (D6). The new route and the cache header.**
The route sits under `/api/v1/commerce/premium/`.
The test asserts the exact header `Cache-Control: private, no-store` on 200, 401 and 500, so a middleware path change cannot drop it unnoticed.

**TEA-19 (D1). Partial unique index precedent.**
Prisma cannot express it. Write it in raw SQL like `20261024120000_community_post_sponsorship` (`WHERE "ended_at" IS NULL`), so `migration-hygiene.spec.ts` and the drift check stay green.

**TEA-20 (D2). Realtime closes within one revalidation.**
Realtime revalidates every 4 to 6 seconds (`community-realtime.server.ts:42`).
With TEA-01, a revoked grantee's open socket closes on its next revalidation.
The matrix gains that row.

**TEA-21 (intent, D7, D8). An admin with an erasure request can still grant.**
6.13 found that an erased moderator could still decide (its C2).
The same gap exists here: `resolveAdminActor` checks the role claim and nothing else, so an admin whose erasure is pending can grant or revoke, and a grant committing after that admin's erasure writes `granted_by_id` back after TEA-11 nulled it.
The fix: grant and revoke refuse an actor with a `ModerationErasureRequest` as `actor_erasure_requested`, and take the actor's and the member's guard and `community_member:` lock in sorted id order before reading either request row.
The closed list gains `actor_erasure_requested`.

---

## Executive Summary

**Scope:** one worker-only table with a partial unique index and a check, one read seam behind a kill switch, an override in the flag service, the community cache and its fixture branch, the premium seam and checkout refusal, an owner-only CLI with two audit events, erasure of grants, one read route with a shared contract, web and mobile complimentary states, and the production dispatch switch-on.

**Risk summary:**

- Total risks: 20
- High (score >= 6): 9, of which 1 at score 9
- Medium (score 3 to 4): 8
- Low (score 1 to 2): 3
- R-02 at 9 blocks until TEA-03 and TEA-15 are built and `E-FREE-OPENS` passes beside its control `E-CONTROL-LOCKED`.

**Coverage summary:** 141 scenarios: P0 105, P1 33, P2 3, P3 0. By level: DB 12, Unit 42, Integration 53, API 16, Contract 4, Component 8, E2E 4, Manual 2. Twenty-one seeded-defect proofs sit outside the count.

**Red-first:** 131 red-first, 8 green guards, 2 manual.

**Effort:** roughly 30 to 50 hours, most of it in the cache race harness, the owned E2E runtime and the CLI integration suite.

---

## Not in Scope

| Item                                       | Reasoning                                                         | Mitigation                                                           |
| ------------------------------------------ | ----------------------------------------------------------------- | -------------------------------------------------------------------- |
| RevenueCat and Stripe behavior             | Billing files stay byte-identical (D5).                           | `G-BILLING-UNTOUCHED` and the existing billing suites run unchanged. |
| Age, consent, sanction and screening logic | Unchanged code; the story only proves it still runs for grantees. | `I-TEEN-*`, `I-SANCTIONED-*`.                                        |
| PostHog targeting rules                    | The kill switch is global (TEA-04).                               | `U-KILL-SUBJECT`.                                                    |
| Load on the grant read                     | One indexed read per call.                                        | `U-NO-READ-*` counts reads; k6 is out of scope.                      |
| Store purchases on mobile                  | The server cannot refuse an on-device purchase (TEA-07).          | Hidden controls, `M-HIDE-PURCHASE`, stated residual.                 |

---

## Risk Assessment

Scores use probability and impact from 1 to 3.

### High-Priority Risks (Score >= 6)

| Risk ID | Category | Description                                                                                                                                                                       | P   | I   | Score | Mitigation and proof                                                                                                                        |
| ------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- | --- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| R-01    | SEC      | Cache invalidation by nulling leaves the claim cadence and lease: grantee 503 for up to 45 s after grant, and an in-flight refresh keeps a revoked member open for 60 s (TEA-01). | 3   | 2   | 6     | TEA-01 `DELETE`. `I-CACHE-GRANT-IMMEDIATE`, `I-CACHE-REVOKE-INFLIGHT`, `I-CACHE-GRANT-INFLIGHT`.                                            |
| R-02    | TECH     | The proof passes on the seed: E2E fixture mode reads the global row and seeds it true, so a test can go green with no override at all (TEA-03, TEA-15).                           | 3   | 3   | 9     | TEA-03, TEA-15. `U-FIXTURE-OVERRIDE`, `E-FREE-OPENS` with `E-CONTROL-LOCKED`, every integration suite asserts a non-grantee control denied. |
| R-03    | TECH     | A hand-built `CommunityFlagEvaluationService` in the push worker never sees grants, so production push never reaches grantees (TEA-05).                                           | 2   | 3   | 6     | Required constructor argument. `U-WIRE-*`, `I-PUSH-GRANTEE`.                                                                                |
| R-04    | SEC      | A grant opens access for the wrong member, or a read error fails open.                                                                                                            | 2   | 3   | 6     | D2 fail-closed. `U-ISACTIVE-ERROR`, `I-OTHER-MEMBER`, `I-CACHE-KEYED`.                                                                      |
| R-05    | DATA     | A grant survives erasure, by a missed `DELETE` or by racing the request, or an erased admin's id comes back on a late grant (TEA-09, TEA-21).                                     | 2   | 3   | 6     | D8, TEA-09, TEA-11, TEA-21. `I-ERASE-*`, `I-ERASE-RACE-GRANT`, `I-ERASE-RACE-GRANTER`, `L-*`.                                               |
| R-06    | SEC      | A member id, email or reason reaches `AuditLog`, logs or telemetry.                                                                                                               | 2   | 3   | 6     | One audit helper. `I-AUDIT-EXACT`, `U-LOG-NO-MEMBER`, `I-CLI-LOG-SCAN`.                                                                     |
| R-07    | SEC      | A non-admin, a wrong database or an ambient `DATABASE_URL` writes a grant (TEA-08).                                                                                               | 2   | 3   | 6     | Copied targeting and `resolveAdminActor`. `U-CLI-TARGET-*`, `I-CLI-ACTOR-*`.                                                                |
| R-08    | BUS      | Members without a grant change behavior: an extra query fails, slows or changes an answer on every premium and community request.                                                 | 2   | 3   | 6     | TEA-16 order, fail-closed. `U-NO-READ-*`, `I-OTHER-MEMBER`, existing suites green.                                                          |
| R-09    | DATA     | Billing touches the grant, or the grant touches billing: the sweep expires access, or a grant row appears in `PremiumEntitlement`.                                                | 2   | 3   | 6     | D1, D5. `G-BILLING-UNTOUCHED`, `I-SWEEP-KEEPS`, `I-WEBHOOK-KEEPS`.                                                                          |

### Medium-Priority Risks (Score 3 to 4)

| Risk ID | Category | Description                                                                                                                         | P   | I   | Score | Mitigation and proof                                               |
| ------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------- | --- | --- | ----- | ------------------------------------------------------------------ |
| R-10    | OPS      | The kill switch is slow or blocks: a per-member PostHog call inside the 1 s refresh budget turns grantees' reads into 503 (TEA-04). | 2   | 2   | 4     | TEA-04. `U-REFRESH-BOUNDED`, `I-KILL-*`.                           |
| R-11    | DATA     | Concurrent grants or revokes create two active rows or two audit rows (TEA-10).                                                     | 2   | 2   | 4     | Partial unique index. `I-CLI-RACE-*`, `D-UNIQ-ACTIVE`.             |
| R-12    | BUS      | Client shows subscribe to a grantee, or shows complimentary when the access read fails (TEA-14).                                    | 2   | 2   | 4     | `W-*`, `M-*`.                                                      |
| R-13    | BUS      | Operator moderation paths change for grantee cases without the spec saying so (TEA-13).                                             | 2   | 2   | 4     | D4 text. `I-MOD-RELEASE-*`.                                        |
| R-14    | OPS      | Production dispatch switch-on hits a backlog or stays degraded (TEA-17).                                                            | 2   | 2   | 4     | D9 checks. `X-DISPATCH`.                                           |
| R-15    | SEC      | A revoked grantee keeps an open realtime socket (TEA-20).                                                                           | 2   | 2   | 4     | TEA-01. `I-REALTIME-REVOKE`.                                       |
| R-16    | BUS      | The kill switch is described as instant while community lags 60 s, so an incident responder trusts the wrong bound (TEA-12).        | 2   | 2   | 4     | Guide text. `I-KILL-COMMUNITY-BOUND`, `U-GUIDE-KILL`.              |
| R-17    | SEC      | Age, consent, sanction or screening is skipped for a grantee.                                                                       | 1   | 3   | 3     | Unchanged order. `I-TEEN-*`, `I-SANCTIONED-*`, `I-SCREENING-RUNS`. |

### Low-Priority Risks (Score 1 to 2)

| Risk ID | Category | Description                                                                                       | P   | I   | Score | Action                                       |
| ------- | -------- | ------------------------------------------------------------------------------------------------- | --- | --- | ----- | -------------------------------------------- |
| R-18    | TECH     | Contract drift: the subscription response gains a key, or the access schema and OpenAPI disagree. | 1   | 2   | 2     | `C-*`, existing subscription Pact unchanged. |
| R-19    | BUS      | Checkout charges a grantee while purchasing is on.                                                | 1   | 2   | 2     | `A-CHECKOUT-409`.                            |
| R-20    | OPS      | File budget over 100, or a CI job over 20 minutes.                                                | 2   | 1   | 2     | Verification step, owned E2E job timing.     |

### Risk Category Legend

TECH architecture and wiring. SEC access and privacy. DATA integrity and erasure. BUS user-visible behavior. OPS operations and incident response.

---

## Entry Criteria

- The spec's Plan Change Log carries TEA-01 to TEA-21, and the (intent) items are applied or ruled out by the builder.
- An isolated database for integration and E2E runs. No suite touches `127.0.0.1:54322` without `PLAYWRIGHT_SKIP_DB_RESET=true` and an isolated `DATABASE_URL`.

## Exit Criteria

- Every P0 and P1 scenario green, and every seeded defect turns its named test red.
- `E-FREE-OPENS` green in the owned runtime with `E-CONTROL-LOCKED` green in the same run.
- Billing suites green with zero diff in the billing files.

---

## Test Catalog

Every integration suite that proves an override seeds the six flags false in its own database and asserts a non-grantee control denied in the same test.
The fake remote provider answers `false` for every flag except where a test says otherwise.

### Database (`packages/db/test/complimentary-access-schema.spec.ts`, `rls/harness.ts`, `migration-hygiene.spec.ts`)

| ID                     | P   | Scenario                                                                                                          | Red-first |
| ---------------------- | --- | ----------------------------------------------------------------------------------------------------------------- | --------- |
| D-TABLE-SHAPE          | P0  | Columns, types, FK actions: `member_id` cascade, `granted_by_id` and `revoked_by_id` set null.                    | yes       |
| D-UNIQ-ACTIVE          | P0  | Second unrevoked row for one member raises 23505. A revoked row plus a new active row succeeds.                   | yes       |
| D-CHECK-REVOKE-SET     | P0  | `revoked_at` without `revoke_reason` and the reverse each raise 23514.                                            | yes       |
| D-CHECK-ERASED-REVOKER | P0  | Revoked row with null `revoked_by_id` is accepted (TEA-11). Active row with non-null `revoked_by_id` raises.      | yes       |
| D-CHECK-REASON-LEN     | P0  | `reason` and `revoke_reason` of 0 and 201 characters raise, 1 and 200 succeed.                                    | yes       |
| D-RLS-WORKER-ONLY      | P0  | RLS on, zero policies, no grant to `anon`, `authenticated` or `service_role`. The table is in `workerOnlyTables`. | yes       |
| D-RLS-ANON-DENIED      | P0  | `authenticated` select, insert, update and delete each answer 42501.                                              | yes       |
| D-CASCADE-USER         | P0  | Deleting the member's `User` removes the grant rows.                                                              | yes       |
| D-SETNULL-GRANTER      | P1  | Deleting the granter's `User` nulls `granted_by_id` and `revoked_by_id`.                                          | yes       |
| D-CLEANUP              | P1  | `packages/testing/src/cleanup.ts` removes the table between tests.                                                | yes       |
| D-MIG-HYGIENE          | P1  | `migration-hygiene.spec.ts` passes with the raw partial index; the drift check is clean.                          | guard     |
| D-SEED-FLAG            | P1  | The seed writes `complimentary_access_enabled` true.                                                              | yes       |

### Config (`packages/config/src/flags.spec.ts`)

| ID                | P   | Scenario                                                                                                                                                 | Red-first |
| ----------------- | --- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| U-FLAG-DEFAULT    | P0  | `complimentary_access_enabled` is boolean, default `true`. The default-true set is exactly that flag and `weather_alerts_enabled`.                       | yes       |
| U-FLAG-LIST-EXACT | P0  | `COMPLIMENTARY_MEMBER_FLAGS` equals the six D4 names in order, and excludes both commerce flags, every `moderation_*` flag and `weather_alerts_enabled`. | yes       |

### Read seam units (`complimentary-access.service.spec.ts`)

| ID                 | P   | Scenario                                                                                                       | Red-first |
| ------------------ | --- | -------------------------------------------------------------------------------------------------------------- | --------- |
| U-ISACTIVE-TRUE    | P0  | Unrevoked grant and kill switch true answer true.                                                              | yes       |
| U-ISACTIVE-REVOKED | P0  | Only revoked grants answer false.                                                                              | yes       |
| U-ISACTIVE-KILL    | P0  | Grant with kill switch false answers false.                                                                    | yes       |
| U-ISACTIVE-ORDER   | P0  | No grant: the remote provider is never called (TEA-04).                                                        | yes       |
| U-KILL-SUBJECT     | P0  | The kill switch is evaluated for `complimentary-access-kill-switch`; the member id never reaches the provider. | yes       |
| U-ISACTIVE-ERROR   | P0  | Grant read rejects: answer false, one `complimentary_access_unavailable` log, no member id in it.              | yes       |
| U-KILL-FALLBACK    | P1  | Remote undefined: the `FeatureFlag` row decides; row absent: default true.                                     | yes       |
| U-KILL-DEADLINE    | P1  | Remote slower than its deadline: the fallback answers, the call finishes inside 600 ms.                        | yes       |
| U-NO-CACHE         | P0  | Two calls with a revoke between them answer true then false; nothing is memoized.                              | yes       |

### Flag service and community cache units (`feature-flags.service.spec.ts`, `community-flag-evaluation.service.spec.ts`)

| ID                      | P   | Scenario                                                                                                | Red-first |
| ----------------------- | --- | ------------------------------------------------------------------------------------------------------- | --------- |
| U-SHORTCUT-FIVE         | P0  | For each of the five shortcut flags, an active grantee answers true while the remote answers false.     | yes       |
| U-SHORTCUT-NOT-READ     | P0  | `community_read_enabled` never takes the shortcut; it goes through `communityReadEvaluation` (TEA-02).  | yes       |
| U-SHORTCUT-OTHERS       | P0  | Commerce and moderation flags for a grantee resolve exactly as for a non-grantee.                       | yes       |
| U-NO-READ-OTHER-KEYS    | P1  | Non-listed keys make zero grant reads (TEA-16).                                                         | yes       |
| U-FIXTURE-OVERRIDE      | P0  | Fixture branch with row false: grantee gets a true grant, non-grantee false (TEA-03).                   | yes       |
| U-REFRESH-COMPLIMENTARY | P0  | Refresh for a grantee writes `true` without calling the remote provider.                                | yes       |
| U-REFRESH-BOUNDED       | P0  | Grant read hangs: refresh still invokes the remote by `invokeBy` and writes the remote answer (TEA-04). | yes       |
| U-REFRESH-ERROR         | P0  | Grant read rejects: refresh writes the remote answer, logs once.                                        | yes       |
| U-COMMENT-REMOTE-ONLY   | P2  | The rewritten comment no longer says remote-only.                                                       | guard     |

### Premium and checkout units (`premium-entitlement.service.spec.ts`, `stripe-billing.service.spec.ts`)

| ID                   | P   | Scenario                                                                                                                                                                            | Red-first |
| -------------------- | --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| U-PREMIUM-PAID-FIRST | P0  | Paid `active` or `grace_period`: true with zero grant reads (TEA-16).                                                                                                               | yes       |
| U-PREMIUM-GRANT      | P0  | No paid row, active grant: true. `expired`, `revoked` row with grant: true.                                                                                                         | yes       |
| U-PREMIUM-NONE       | P0  | No row, no grant: false.                                                                                                                                                            | yes       |
| U-CHECKOUT-ORDER     | P0  | Purchasing off and grantee: 503 first. Purchasing on, paid and grantee: paid 409 first. Purchasing on, grantee only: 409 `complimentary_access_active`, zero Stripe calls (TEA-07). | yes       |
| U-PORTAL-UNCHANGED   | P1  | Portal for a paid grantee behaves as today.                                                                                                                                         | guard     |

### Operator units (`complimentary-access-operator.service.spec.ts`, `complimentary-access.cli.spec.ts`, shared admin-actor helper spec)

| ID                         | P   | Scenario                                                                                      | Red-first |
| -------------------------- | --- | --------------------------------------------------------------------------------------------- | --------- |
| U-CLI-USAGE                | P1  | Missing subcommand or flag: exit 2 and the usage text.                                        | yes       |
| U-CLI-TARGET-AMBIENT       | P0  | Ambient `DATABASE_URL` is ignored; only `--env-file` counts (TEA-08).                         | yes       |
| U-CLI-TARGET-REMOTE        | P0  | Remote host without `--confirm-target`, or with the wrong ref: refused, no client created.    | yes       |
| U-CLI-DRY-RUN              | P1  | `--dry-run` prints the plan and writes nothing.                                               | yes       |
| U-CLI-REASON               | P0  | Reason of 0, 201 characters or control characters: `invalid_reason`, exit 1.                  | yes       |
| U-CLI-CODES-CLOSED         | P0  | Every refusal prints one of the closed codes and exits 1.                                     | yes       |
| U-ADMIN-HELPER-SPONSORSHIP | P0  | The sponsorship command's refusal codes and messages are byte-identical after the extraction. | guard     |
| U-LOG-NO-MEMBER            | P0  | Operator logs carry grant id and code only; a canary email and reason never appear.           | yes       |

### Wiring units (`community.bootstrap.spec.ts`, `bootstrap.spec.ts`, `community-engagement.runtime.spec.ts`, `feature-flags.module` spec)

| ID                      | P   | Scenario                                                                                          | Red-first |
| ----------------------- | --- | ------------------------------------------------------------------------------------------------- | --------- |
| U-WIRE-COMMUNITY-WORKER | P0  | The community worker's `CommunityFlagEvaluationService` holds the complimentary service (TEA-05). | yes       |
| U-WIRE-GENERAL-WORKER   | P0  | Both `bootstrap.ts` sites and the premium service at `:228` hold it.                              | yes       |
| U-WIRE-RUNTIME          | P0  | `community-engagement.runtime.ts` passes it to the send guard's evaluator.                        | yes       |
| U-WIRE-NEST             | P1  | The Nest module resolves without a cycle and exports the service.                                 | yes       |

### Contract units (`packages/api-client/testing/premium-access-contract.spec.ts`)

| ID                      | P   | Scenario                                                                                                                      | Red-first |
| ----------------------- | --- | ----------------------------------------------------------------------------------------------------------------------------- | --------- |
| U-C-STRICT              | P0  | The schema accepts the three `source` values and rejects an extra key, a missing key and `premium:true` with `source:'none'`. | yes       |
| U-C-SUBSCRIPTION-FROZEN | P0  | The subscription schema and its OpenAPI entry are unchanged from baseline.                                                    | guard     |
| U-C-OPENAPI             | P1  | OpenAPI and the generated SDK carry the route, bearer security and the schema.                                                | yes       |

### Integration: overrides (`apps/api/integration/complimentary-access-override.integration.spec.ts`, real Postgres, six flags false, fake remote false)

| ID                      | P   | Scenario                                                                                                                                                                             | Red-first |
| ----------------------- | --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------- |
| I-OVERRIDE-READ         | P0  | Grantee's `communityReadEvaluation` is true through the cache path with fixture mode off. Control false.                                                                             | yes       |
| I-OVERRIDE-FIXTURE      | P0  | Same with fixture mode on, which is the E2E path.                                                                                                                                    | yes       |
| I-OTHER-MEMBER          | P0  | A grant for member A leaves member B's answers for all six flags and premium unchanged.                                                                                              | yes       |
| I-CACHE-KEYED           | P0  | A's cache row is true, B's row is untouched by A's grant and revoke.                                                                                                                 | yes       |
| I-CACHE-GRANT-IMMEDIATE | P0  | Row claimed and false with `next_claim_at` 45 s ahead; grant commits; the next evaluation answers true with no 503 (TEA-01).                                                         | yes       |
| I-CACHE-REVOKE-INFLIGHT | P0  | Forced order: refresh reads grant true and pauses before its write; revoke commits; the refresh resumes. The row is absent or false, and the next evaluation answers false (TEA-01). | yes       |
| I-CACHE-GRANT-INFLIGHT  | P0  | Same order for grant: the stale false never lands, and the next evaluation answers true.                                                                                             | yes       |
| I-KILL-OFF              | P0  | Kill switch row false: grantee answers as without a grant for all six flags and premium after cache expiry.                                                                          | yes       |
| I-KILL-COMMUNITY-BOUND  | P1  | Kill switch off with a cached true row: true until `expires_at`, false after, at most 60 s (TEA-12). Clock driven by backdating `expires_at`.                                        | yes       |
| I-KILL-REMOTE-SLOW      | P1  | Remote hangs past the deadline: cold grantee evaluation completes within the 2 s budget and answers true.                                                                            | yes       |
| I-REALTIME-REVOKE       | P1  | Grantee socket open, revoke commits, socket closes within one revalidation, under 7 s (TEA-20).                                                                                      | yes       |
| I-MOD-RELEASE-GRANTEE   | P1  | Flagged post by a grantee: `releaseFlaggedPost` publishes it. Same for a non-grantee: 503 (TEA-13).                                                                                  | yes       |
| I-MOD-DECISION-GRANTEE  | P2  | `writesOpenFor` a grantee subject is true, for a non-grantee false.                                                                                                                  | yes       |

### Integration: push (`apps/api/integration/complimentary-access-push.integration.spec.ts`, engagement harness)

| ID             | P   | Scenario                                                                                                                                                                   | Red-first |
| -------------- | --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| I-PUSH-GRANTEE | P0  | Grantee and non-grantee both opted in, engagement on both posts: grantee delivery sent, non-grantee `suppressed` `no_call:read_disabled`. Uses the worker-built evaluator. | yes       |
| I-PUSH-REVOKED | P0  | Revoke before dispatch: grantee delivery suppressed.                                                                                                                       | yes       |
| I-PUSH-OPT-OUT | P1  | Grantee with push disabled: `no_call:opt_out`.                                                                                                                             | yes       |

### Integration: premium and billing (`apps/api/integration/complimentary-access-premium.integration.spec.ts`)

| ID              | P   | Scenario                                                                                                                                             | Red-first |
| --------------- | --- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| I-SWEEP-KEEPS   | P0  | Reconciliation pulls a null ledger for a grantee with a paid row: the paid row changes as today, the grant row is byte-identical, access stays true. | yes       |
| I-WEBHOOK-KEEPS | P0  | RevenueCat `EXPIRATION` for a paid grantee: paid row expires, grant intact, access true, `source` complimentary.                                     | yes       |
| I-REFRESH-KEEPS | P1  | Subscription refresh for a grantee leaves the grant intact.                                                                                          | yes       |
| I-REVOKE-PAID   | P0  | Paid active grantee revoked: access true, `source` subscription.                                                                                     | yes       |
| I-REVOKE-FREE   | P0  | Free grantee revoked: next request premium routes 403, `source` none.                                                                                | yes       |

### Integration: CLI and audit (`apps/api/integration/complimentary-access-cli.integration.spec.ts`, real Postgres with the `auth.users` fixture)

| ID                   | P   | Scenario                                                                                                                                                                  | Red-first |
| -------------------- | --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| I-CLI-GRANT          | P0  | Admin grants: one row with reason, granter and time; one `AuditLog` row; cache row deleted.                                                                               | yes       |
| I-AUDIT-EXACT        | P0  | The audit row's `user_id` is the actor, `event_type` exact, `event_data` exactly `{grantId}`; a canary member email, id and reason appear nowhere in it. Same for revoke. | yes       |
| I-CLI-ACTOR-NONADMIN | P0  | Actor without `app_role: admin`: `actor_not_admin`, zero rows written in any table.                                                                                       | yes       |
| I-CLI-ACTOR-MISSING  | P0  | Unknown actor, auth user with no app user, and mismatched emails: their codes, zero writes.                                                                               | yes       |
| I-CLI-MEMBER-MISSING | P0  | Unknown member email: `member_not_found`, zero writes.                                                                                                                    | yes       |
| I-CLI-ALREADY        | P0  | Second grant: `already_granted`, the existing grant id printed, zero writes.                                                                                              | yes       |
| I-CLI-RACE-GRANT     | P0  | Two grants released together: one row, one audit row, the loser `already_granted` (TEA-10).                                                                               | yes       |
| I-CLI-RACE-REVOKE    | P1  | Two revokes released together: one stamp, one audit row, the loser `no_active_grant`.                                                                                     | yes       |
| I-CLI-NO-ACTIVE      | P0  | Revoke with no active grant: `no_active_grant`, zero writes.                                                                                                              | yes       |
| I-CLI-ATOMIC         | P0  | Audit insert forced to fail: no grant row, cache row still present.                                                                                                       | yes       |
| I-CLI-LIST           | P1  | `list` prints active grants only, with grant id, member email, reason, granter email or `[erased]`, time.                                                                 | yes       |
| I-CLI-LOG-SCAN       | P0  | Captured stdout, stderr and logger output for grant and revoke carry no reason text; member email appears only in `list` stdout.                                          | yes       |

### Integration: erasure (`apps/api/integration/complimentary-access-erasure.integration.spec.ts`)

| ID                   | P   | Scenario                                                                                                                                                                            | Red-first |
| -------------------- | --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| I-ERASE-DELETES      | P0  | Member with an active and a revoked grant requests erasure: no grant row references them; audit rows keep actor and grant id only.                                                  | yes       |
| I-ERASE-GRANTER      | P0  | Admin granter requests erasure: `granted_by_id` and `revoked_by_id` naming them are null; the grantee keeps access (TEA-11).                                                        | yes       |
| I-ERASE-REFUSE-GRANT | P0  | Grant after the request: `member_erasure_requested`, zero writes.                                                                                                                   | yes       |
| I-ERASE-RACE-GRANT   | P0  | Forced order: grant passes its checks and pauses; erasure starts. The erasure waits for the grant, then deletes it; or the grant waits and refuses. Never a surviving row (TEA-09). | yes       |
| I-ERASE-ROLLBACK     | P1  | Grant delete forced to fail inside erasure: the whole erasure rolls back.                                                                                                           | yes       |

### Integration: eligibility for grantees (`complimentary-access-override.integration.spec.ts`)

| ID                 | P   | Scenario                                                                                                                 | Red-first |
| ------------------ | --- | ------------------------------------------------------------------------------------------------------------------------ | --------- |
| I-TEEN-CONSENT     | P0  | Grantee under 16 without guardian consent: premium routes 200; community upload refused with the existing consent error. | yes       |
| I-SANCTIONED-WRITE | P0  | Banned grantee: posting refused by the sanction, flag open.                                                              | yes       |
| I-SCREENING-RUNS   | P0  | Grantee's publish goes to `pending_review` and through the moderation outbox as for anyone.                              | yes       |
| I-ERASED-SUBJECT   | P1  | A grantee whose subject is erased gets the terminal denial before any flag read.                                         | yes       |

### Integration: lifecycle ordered pairs (`apps/api/integration/complimentary-access-lifecycle.integration.spec.ts`)

Each row runs its events in the stated order, across the member, the granting admin and a second admin, and asserts the exact state after every step: grant rows, audit rows, `source` from the access route, and one premium and one community answer.

| ID                           | P   | Scenario                                                                                                                                                                                                                        | Red-first |
| ---------------------------- | --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| L-REGRANT                    | P0  | Grant, revoke, grant again: two rows, one active; three audit rows; access true, false, true; the cache row is deleted at each step.                                                                                            | yes       |
| L-REVOKE-OTHER-ADMIN         | P1  | Admin A grants, admin B revokes: `revoked_by_id` is B; both audit rows keyed to their own actor.                                                                                                                                | yes       |
| L-GRANTER-DEMOTED            | P1  | Admin A grants, then loses `app_role`: the grant stays active; A's revoke refuses `actor_not_admin`; B's revoke succeeds.                                                                                                       | yes       |
| L-GRANTER-ERASED-THEN-REVOKE | P0  | A grants, A requests erasure, B revokes: the member had access until the revoke; `granted_by_id` null, `revoked_by_id` B; `list` shows `[erased]` before the revoke.                                                            | yes       |
| L-ERASED-THEN-REVOKE         | P0  | Grant, member requests erasure, revoke: `member_erasure_requested` (D7 checks the request before the grant row); grant again: `member_erasure_requested`; zero rows for the member.                                             | yes       |
| L-SELF-GRANT                 | P2  | Admin grants themselves, then requests erasure: the row is gone and no grant column names them.                                                                                                                                 | yes       |
| L-PAID-SEQUENCE              | P0  | Free, grant, store purchase webhook, store expiry webhook, revoke: `source` none, complimentary, complimentary, complimentary, none; access false, true, true, true, false; the paid row follows the webhooks exactly as today. | yes       |
| L-KILL-THEN-GRANT            | P1  | Kill switch off, grant, kill switch on: access false then true; the grant written while off is effective.                                                                                                                       | yes       |
| L-REVOKE-DURING-KILL         | P1  | Grant, kill switch off, revoke, kill switch on: access stays false.                                                                                                                                                             | yes       |
| I-CLI-ACTOR-ERASURE          | P0  | Admin with an erasure request grants or revokes: `actor_erasure_requested`, zero writes (TEA-21).                                                                                                                               | yes       |
| I-ERASE-RACE-GRANTER         | P0  | Forced order in both directions: A's grant and A's erasure. Either the grant refuses or the erasure nulls the new `granted_by_id`; never a grant row naming A after A's request commits (TEA-21).                               | yes       |

### API routes (`apps/api/integration/complimentary-access-routes.integration.spec.ts`, real Nest over HTTP)

| ID                  | P   | Scenario                                                                                                                                   | Red-first |
| ------------------- | --- | ------------------------------------------------------------------------------------------------------------------------------------------ | --------- |
| A-AC1-THEME         | P0  | Free grantee, flags off: theme GET `isEntitled:true`, PUT 200. Control: PUT 403.                                                           | yes       |
| A-AC1-PALETTE       | P0  | Palette GET `isEntitled:true`, `analysisEnabled:true`. Control: locked.                                                                    | yes       |
| A-AC1-PLANNER       | P0  | Planner GET 200 and reshuffle 200. Control 403.                                                                                            | yes       |
| A-AC1-FEED          | P0  | Feed 200. Control 403 `denied` (TEA-06).                                                                                                   | yes       |
| A-AC1-POST          | P0  | Upload allocate and publish 2xx. Control 503.                                                                                              | yes       |
| A-AC1-SHARE         | P0  | Share capabilities report native share on; `purpose:'share'` prepare 2xx. Control off and 403.                                             | yes       |
| A-REVOKE-NEXT       | P0  | Revoke, then the next request on each AC1 route answers as the control.                                                                    | yes       |
| A-ACCESS-SHAPE      | P0  | `GET /api/v1/commerce/premium/access` for none, subscription, complimentary and both (`complimentary` wins) parses with the strict schema. | yes       |
| A-ACCESS-HEADERS    | P0  | `Cache-Control: private, no-store` on 200, 401 and 500 (TEA-18).                                                                           | yes       |
| A-ACCESS-AUTH       | P0  | No bearer: 401. Cookie-only: 401.                                                                                                          | yes       |
| A-ACCESS-KILL       | P1  | Kill switch off: `source` none or subscription.                                                                                            | yes       |
| A-ACCESS-ERROR      | P1  | Grant read fails: `source` subscription or none, 200, no 500.                                                                              | yes       |
| A-CHECKOUT-409      | P0  | Purchasing on, free grantee: 409 `complimentary_access_active`, zero fake-Stripe calls, no `BillingCustomer` row.                          | yes       |
| A-CHECKOUT-503      | P1  | Purchasing off, grantee: 503 as today.                                                                                                     | guard     |
| A-SUBSCRIPTION-SAME | P0  | `GET /api/v1/commerce/subscription` for a free grantee is byte-identical to a free member's.                                               | yes       |
| A-NO-GRANT-ROUTE    | P0  | No HTTP route writes the table: route table scan finds no handler referencing the grant model's write path.                                | yes       |

### Contract (`pact/http/`)

| ID                       | P   | Scenario                                                                                                                                                                                   | Red-first |
| ------------------------ | --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------- |
| C-WEB-ACCESS             | P0  | Web consumer interaction for the access route, states `complimentary` and `none`, with `createProviderState` and `setJsonContent`, matchers from `zodToPactMatchers` on the shared schema. | yes       |
| C-MOBILE-ACCESS          | P0  | Mobile consumer interaction, same states.                                                                                                                                                  | yes       |
| C-PROVIDER-STATES        | P0  | Provider states seed a grant through the test helper, verified with `buildVerifierOptions`.                                                                                                | yes       |
| C-SUBSCRIPTION-UNCHANGED | P0  | The existing subscription interactions verify unchanged.                                                                                                                                   | guard     |

### Web and mobile components (`subscription-section.test.tsx`, `apps/web/src/lib/premium` tests, mobile `settings` and `premium` tests)

| ID              | P   | Scenario                                                                                                 | Red-first |
| --------------- | --- | -------------------------------------------------------------------------------------------------------- | --------- |
| W-COMPLIMENTARY | P0  | `source` complimentary, no paid row: "Complimentary access" state, no subscribe control.                 | yes       |
| W-BOTH          | P0  | Complimentary and paid: complimentary note and the subscription block with portal link.                  | yes       |
| W-ACCESS-FAIL   | P0  | Access read fails: section renders as today, no complimentary text (TEA-14).                             | yes       |
| W-LOCALES       | P1  | All ten web locales carry the new keys; parity spec green; axe clean in light and dark.                  | yes       |
| M-COMPLIMENTARY | P0  | Mobile settings show the complimentary state.                                                            | yes       |
| M-HIDE-PURCHASE | P0  | Mobile renders no purchase control and never configures `Purchases` for a complimentary member (TEA-07). | yes       |
| M-ACCESS-FAIL   | P0  | Access read fails: settings render as today.                                                             | yes       |
| M-LOCALES       | P1  | Mobile commerce locales parity in `commerce-locales.spec.ts`.                                            | yes       |

### End to end (`playwright/tests/complimentary-access.spec.ts`, owned runtime, TEA-15)

Uses `apiRequest` for setup reads, `interceptNetworkCall` to observe the access call, `recurse` for any wait, `log` for steps, and the merged fixtures. The grant runs through the real CLI against the isolated database. `network-error-monitor` stays on, with the control's expected 403 and 503 listed as allowed.

| ID               | P   | Scenario                                                                                                                                                                                  | Red-first |
| ---------------- | --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| E-FREE-OPENS     | P0  | Free member granted by the CLI, six flags false: settings show "Complimentary access", premium theme switch works, planner opens, feed loads, a post publishes. Desktop and mobile width. | yes       |
| E-CONTROL-LOCKED | P0  | In the same run, a non-grantee sees the locked premium states and the community unavailable state.                                                                                        | yes       |
| E-REVOKE         | P0  | CLI revoke, reload: locked states return for the former grantee.                                                                                                                          | yes       |
| E-A11Y-THEMES    | P1  | The complimentary state passes axe in light and dark at both widths; screenshot review for pixel issues.                                                                                  | yes       |

### Documents and process

| ID                  | P   | Scenario                                                                                                                                                                                                                                                                    | Red-first |
| ------------------- | --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| G-BILLING-UNTOUCHED | P0  | Static spec: `billing-webhook.service.ts`, `billing-reconciliation.service.ts`, `subscription.service.ts`, `applyLedgerEvent` and `applyLedgerSnapshot` bodies, and the RevenueCat and Stripe clients never name the grant model; `git diff main` for those files is empty. | guard     |
| U-GUIDE-KILL        | P1  | The guide's Complimentary access section states the 60 s community bound and the incident rule (TEA-12).                                                                                                                                                                    | yes       |
| X-DISPATCH          | P0  | Manual, post-merge: backlog count, flip, `ready` log, a test grantee delivery sent and a non-grantee delivery suppressed (TEA-17).                                                                                                                                          | manual    |
| X-PROD-GRANT        | P0  | Manual, post-merge: one real grant for a test account, `list` shows it, revoke, `list` shows none, audit rows hold no member identity.                                                                                                                                      | manual    |

### Generated totals

| Level       | Count                                                                                                            |
| ----------- | ---------------------------------------------------------------------------------------------------------------- |
| DB          | 12                                                                                                               |
| Unit        | 42 (config 2, seam 9, flags and cache 9, premium 5, operator 8, wiring 4, contract 3, guide 1, billing static 1) |
| Integration | 53                                                                                                               |
| API         | 16                                                                                                               |
| Contract    | 4                                                                                                                |
| Component   | 8                                                                                                                |
| E2E         | 4                                                                                                                |
| Manual      | 2                                                                                                                |
| **Total**   | **141**                                                                                                          |

Priority: P0 105, P1 33, P2 3. Green guards: `D-MIG-HYGIENE`, `U-COMMENT-REMOTE-ONLY`, `U-PORTAL-UNCHANGED`, `U-ADMIN-HELPER-SPONSORSHIP`, `U-C-SUBSCRIPTION-FROZEN`, `A-CHECKOUT-503`, `C-SUBSCRIPTION-UNCHANGED`, `G-BILLING-UNTOUCHED`.
The contract units (`U-C-*`) count in Unit.

---

## Test data and harness

- One factory creates a member, an admin with an `auth.users` row carrying `app_role: admin`, and a grant written through the operator service. No test writes the grant table with raw SQL except the DB suite.
- The fake remote provider records every `(flagKey, subjectId)` call, which `U-KILL-SUBJECT` and `U-ISACTIVE-ORDER` read.
- Forced-order races poll `pg_stat_activity` for the lock wait, in both orders, with no sleeps (the 6.13 pattern). The refresh race uses a deferred promise between the grant read and the write. Two operator commands are released together by an advisory lock the test holds.
- Every assertion is exact: status, body and code. No `>= 400` or `< 500`.
- Clock control for the 60 s bound backdates `expires_at` in SQL; no test sleeps 60 seconds.
- Canary values for leak scans: member email `canary-614-member@example.test`, reason `canary-614-reason`.
- Cleanup deletes users and lets foreign keys act.

### File plan against the budget

New spec files: about 12 (DB 1, units 4 new plus edits, integration 6, Pact interactions 1, Playwright 1 plus the owned-runtime prepare script and config). The builder's count of production files plus these must stay at or under 100.

---

## Execution strategy

- PR: unit, DB, contract, integration and API suites in the existing jobs; the owned E2E runtime as one job under 20 minutes; Pact consumer and provider in their jobs.
- Integration suites run with `NODE_OPTIONS=--conditions=development` against the isolated database.
- Sign-off burns the whole touched suites, never a filtered subset.

---

## Red-first plan and seeded-defect proofs

Order for the build:

1. Migration and harness with `D-*` red.
2. Config with `U-FLAG-*` red.
3. Read seam with `U-ISACTIVE-*`, `U-KILL-*`, `U-NO-CACHE` red, then `ComplimentaryAccessService`.
4. Wiring with `U-WIRE-*` red before any constructor changes.
5. Flag service and cache with `U-SHORTCUT-*`, `U-FIXTURE-OVERRIDE`, `U-REFRESH-*` red, then `I-OVERRIDE-*` and `I-CACHE-*`. `I-CACHE-REVOKE-INFLIGHT` comes before the invalidation code.
6. Premium seam with `U-PREMIUM-*`, `U-CHECKOUT-ORDER`, `I-SWEEP-KEEPS`, `I-WEBHOOK-KEEPS` red.
7. Operator with `U-CLI-*`, `I-CLI-*`, `I-AUDIT-EXACT` red; `U-ADMIN-HELPER-SPONSORSHIP` green before and after the extraction.
8. Erasure with `I-ERASE-*`, `I-CLI-ACTOR-ERASURE` and `L-*` red; `I-ERASE-RACE-GRANT` and `I-ERASE-RACE-GRANTER` first.
9. Contract and route with `U-C-*`, `A-ACCESS-*` red, then `A-AC1-*`.
10. Push with `I-PUSH-*` red.
11. Clients with `W-*` and `M-*` red against contract fixtures.
12. Pact, then the owned E2E runtime and `E-*` last.
13. Guide and sprint status, then `X-*` after merge.

Seeded defects, each run in a throwaway worktree, each must turn the named test red. Evidence goes under `_bmad-output/test-artifacts/story-6-14/`.

| ID   | Defect                                                                          | Must fail                                                  |
| ---- | ------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| S-1  | Invalidation sets `remote_value` and `expires_at` to null                       | `I-CACHE-GRANT-IMMEDIATE`, `I-CACHE-REVOKE-INFLIGHT`       |
| S-2  | Invalidation removed                                                            | `A-REVOKE-NEXT`, `I-PUSH-REVOKED`                          |
| S-3  | Fixture branch skips `isActive`                                                 | `U-FIXTURE-OVERRIDE`, `I-OVERRIDE-FIXTURE`, `E-FREE-OPENS` |
| S-4  | `community_read_enabled` takes the shortcut                                     | `U-SHORTCUT-NOT-READ`                                      |
| S-5  | `isActive` catch returns true                                                   | `U-ISACTIVE-ERROR`, `A-ACCESS-ERROR`                       |
| S-6  | Kill switch ignored                                                             | `U-ISACTIVE-KILL`, `I-KILL-OFF`                            |
| S-7  | Kill switch evaluated with the member id                                        | `U-KILL-SUBJECT`                                           |
| S-8  | Community worker builds the evaluator without the service (optional dependency) | `U-WIRE-COMMUNITY-WORKER`, `I-PUSH-GRANTEE`                |
| S-9  | `commerce_subscription_enabled` added to the list                               | `U-FLAG-LIST-EXACT`, `U-SHORTCUT-OTHERS`                   |
| S-10 | Grant written as a `PremiumEntitlement` row                                     | `G-BILLING-UNTOUCHED`, `I-SWEEP-KEEPS`                     |
| S-11 | `event_data` gains `memberId`                                                   | `I-AUDIT-EXACT`                                            |
| S-12 | `app_role` check removed from the actor helper                                  | `I-CLI-ACTOR-NONADMIN`, `U-ADMIN-HELPER-SPONSORSHIP`       |
| S-13 | CLI reads ambient `DATABASE_URL`                                                | `U-CLI-TARGET-AMBIENT`                                     |
| S-14 | Grant skips the erasure lock                                                    | `I-ERASE-RACE-GRANT`                                       |
| S-15 | Erasure no longer deletes grants                                                | `I-ERASE-DELETES`                                          |
| S-16 | Partial unique index dropped                                                    | `D-UNIQ-ACTIVE`, `I-CLI-RACE-GRANT`                        |
| S-17 | Checkout complimentary 409 removed                                              | `A-CHECKOUT-409`, `U-CHECKOUT-ORDER`                       |
| S-18 | Access route loses its cache header                                             | `A-ACCESS-HEADERS`                                         |
| S-19 | Web shows complimentary when the access read fails                              | `W-ACCESS-FAIL`                                            |
| S-20 | Grant row grants `SELECT` to `authenticated`                                    | `D-RLS-WORKER-ONLY`, `D-RLS-ANON-DENIED`                   |
| S-21 | Actor erasure check removed                                                     | `I-CLI-ACTOR-ERASURE`, `I-ERASE-RACE-GRANTER`              |

---

## Quality Gate Criteria

### Pass/Fail Thresholds

- P0 100 percent, P1 100 percent: misses are fixed in this story.
- Every score 6 or higher mitigation done and proved; R-02 proved by `E-FREE-OPENS` beside `E-CONTROL-LOCKED`.
- Every seeded defect turns its named test red.

### Coverage Targets

- Line coverage on new `complimentary-access*` code at least 85 percent. Every matrix row maps to a scenario below.

### Non-Negotiable Requirements

- Every override proof runs with the six flags false and a non-grantee control in the same test.
- No billing file changes.
- No test or tool runs Playwright or a database reset without an isolated `DATABASE_URL` and `PLAYWRIGHT_SKIP_DB_RESET=true`.

---

## Traceability

### Acceptance criteria

| AC                                          | Scenarios                                                                                             |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| 1 Free grantee, flags off, every route open | `A-AC1-*`, `I-OVERRIDE-*`, `E-FREE-OPENS`, `E-CONTROL-LOCKED`                                         |
| 2 Push only to the grantee                  | `I-PUSH-GRANTEE`, `I-PUSH-REVOKED`, `X-DISPATCH`                                                      |
| 3 Billing leaves the grant alone            | `I-SWEEP-KEEPS`, `I-WEBHOOK-KEEPS`, `I-REFRESH-KEEPS`, `G-BILLING-UNTOUCHED`                          |
| 4 Non-admin or no credentials write nothing | `I-CLI-ACTOR-*`, `U-CLI-TARGET-*`, `L-GRANTER-DEMOTED`                                                |
| 5 One audit row, no member identity         | `I-AUDIT-EXACT`, `I-CLI-RACE-*`, `I-CLI-ATOMIC`                                                       |
| 6 Revoked grantee back to before            | `A-REVOKE-NEXT`, `I-REVOKE-*`, `I-CACHE-REVOKE-INFLIGHT`, `I-REALTIME-REVOKE`, `E-REVOKE`             |
| 7 Erasure                                   | `I-ERASE-*`, `L-GRANTER-ERASED-THEN-REVOKE`, `L-ERASED-THEN-REVOKE`, `L-SELF-GRANT`, `D-CASCADE-USER` |
| 8 CI green, at most 100 files               | Verification commands                                                                                 |

### I/O matrix rows

| Row                            | Scenarios                                                                                   |
| ------------------------------ | ------------------------------------------------------------------------------------------- |
| Free member granted            | `A-AC1-*`, `I-PUSH-GRANTEE`, `E-FREE-OPENS`                                                 |
| Paid member granted            | `A-ACCESS-SHAPE` (both), `U-PORTAL-UNCHANGED`, `W-BOTH`                                     |
| Ledger sweep on grantee        | `I-SWEEP-KEEPS`                                                                             |
| Revoke, free member            | `A-REVOKE-NEXT`, `I-REVOKE-FREE`, `I-PUSH-REVOKED` (feed 403 `denied`, posting 503, TEA-06) |
| Revoke, paid member            | `I-REVOKE-PAID`                                                                             |
| Kill switch off                | `I-KILL-OFF`, `I-KILL-COMMUNITY-BOUND`, `A-ACCESS-KILL`                                     |
| Grant lookup fails             | `U-ISACTIVE-ERROR`, `U-REFRESH-ERROR`, `A-ACCESS-ERROR`                                     |
| Other member                   | `I-OTHER-MEMBER`, `U-NO-READ-*`, existing suites                                            |
| Complimentary checkout         | `A-CHECKOUT-409`, `A-CHECKOUT-503`, `U-CHECKOUT-ORDER`                                      |
| Non-admin actor                | `I-CLI-ACTOR-NONADMIN`                                                                      |
| Double grant                   | `I-CLI-ALREADY`, `I-CLI-RACE-GRANT`                                                         |
| Erasure                        | `I-ERASE-DELETES`, `I-ERASE-GRANTER`, `I-ERASE-ROLLBACK`                                    |
| Teen grantee                   | `I-TEEN-CONSENT`                                                                            |
| Realtime after revoke (TEA-20) | `I-REALTIME-REVOKE`                                                                         |

---

## Execution record

Recorded 2026-11-10 on the branch `feat/story-6-14-complimentary-access`, PR #198, commit `fb24cfd7`.

### Test files

| Slice | File                                                                                                                                                                                                                                  | Tests    |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| 1     | `packages/db/test/complimentary-access-schema.spec.ts`                                                                                                                                                                                | 16       |
| 2     | `packages/config/src/complimentary-member-flags.spec.ts`                                                                                                                                                                              | 2        |
| 3, 5  | `apps/api/integration/complimentary-access-seam.integration.spec.ts`                                                                                                                                                                  | 18       |
| 4     | `apps/api/src/modules/feature-flags/complimentary-access.wiring.spec.ts`                                                                                                                                                              | 6        |
| 5     | `apps/api/integration/complimentary-access-cache.integration.spec.ts`                                                                                                                                                                 | 9        |
| 6     | `apps/api/src/modules/commerce/premium-entitlement.complimentary.spec.ts`, `stripe-billing.complimentary.spec.ts`, `billing-untouched.complimentary.spec.ts`, `apps/api/integration/complimentary-access-premium.integration.spec.ts` | 37       |
| 7     | `apps/api/integration/complimentary-access-cli.integration.spec.ts`                                                                                                                                                                   | 17       |
| 8     | `apps/api/integration/complimentary-access-erasure.integration.spec.ts`                                                                                                                                                               | 18       |
| 9     | `apps/api/integration/complimentary-access-routes.integration.spec.ts`, `packages/api-client/testing/premium-access-contract.spec.ts`, `pact/http/consumer/interactions/premium-access.ts` (4 interactions)                           | 14, 5, 4 |
| 10    | `apps/api/integration/complimentary-access-push.integration.spec.ts`                                                                                                                                                                  | 5        |
| 11    | `apps/web/src/app/components/subscription-section.complimentary.test.tsx`, `apps/mobile/src/screens/settings-premium-section.complimentary.test.tsx`                                                                                  | 11, 10   |
| 12    | `playwright/tests/complimentary-access.spec.ts` on `scripts/e2e-complimentary/run.mjs` and `playwright/config/complimentary.config.ts`                                                                                                | 5        |

### Sign-off runs

- The 6.14 integration suites with the feature-flags and commerce units: 645 of 645, three consecutive runs.
- Every existing integration suite the constructor codemod touched, on a stock `postgres:17` started by `scripts/integration-postgres.mjs`: 24 files, 605 tests, none skipped. The realtime budget config 2 of 2. The Story 6.5 acceptance pair with `RUN_STORY65_ACCEPTANCE=true` and an owned Redis: retention cutoffs 2 of 2, realtime load 1 of 1.
- Pact consumer 460, provider verification green.
- E2E on its owned database: 5 of 5, four runs, 36 to 73 s.
- Lint at zero warnings and `tsc` clean in `apps/api`, `pact`, `playwright` for every TEA file.

### Product defects the tests found

`U-REFRESH-BOUNDED` and `I-KILL-REMOTE-SLOW` (a slow grant read or kill switch made the refresh answer 503), `D-CHECK-REASON-LEN` (whitespace-only reasons passed the CHECK), `U-C-STRICT` (the contract accepted `premium` disagreeing with `source`), `M-HIDE-PURCHASE` (the RevenueCat SDK was configured for a complimentary member), `M-NO-FLASH` (purchase controls flashed before the access read), `M-DISCLOSURE-HIDDEN` (the billing disclosure flashed while the session was unresolved). Each was fixed by the builder and its test is green.

### Seeded defects

All 21 turn their named tests red and return to green on restore; evidence in `_bmad-output/test-artifacts/story-6-14/seeded-defects.md`. The first run exposed three test gaps, closed before sign-off: S-8 (the wiring spec counted arguments only), S-9 (the flag checks derived their expectations from the constant under test), S-10 (nothing compared billing rows around a grant).

### Differences from the plan

- The seam and shortcut scenarios planned as units run against real Postgres in the seam suite, so no assertion depends on the Prisma query shape.
- `L-ERASED-THEN-REVOKE` answers `member_erasure_requested`, because D7 checks the request before the grant row.
- `I-PUSH-GRANTEE` asserts the non-grantee ends `suppressed` with zero attempts; `no_call:read_disabled` appears only on the in-transaction recheck (TEA-23).
- `E-A11Y-THEMES` scans dark only: settings is a dark-only member surface by design.
- Planner in `A-AC1-PLANNER` stops at the location check after passing the guard; the E2E proves the full 200.
- The race scenarios hold the exclusive privacy guard, the first lock both the operator and the erasure take.

### Still open

`X-DISPATCH` and `X-PROD-GRANT` run after merge.

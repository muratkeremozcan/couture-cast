---
title: 'CC-6.14 Complimentary full access'
type: 'feature'
ticket: '6-14-complimentary-full-access'
created: '2026-11-10'
status: 'in-review'
baseline_revision: '63bd6fcd54bce138ea6c970537a9b2f8a9e69abb'
route: 'full'
route_source: 'auto'
risk: 'high'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick']
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-6-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-6-13-immutable-moderation-history.md'
  - '{project-root}/_bmad-output/project-knowledge/deployment-guide.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Premium access comes only from the RevenueCat mirror in `PremiumEntitlement`, and every community lane is closed in production by default-false flags.
The owner cannot give family testers the full product without making them pay, and a grant written into `PremiumEntitlement` would be expired by the reconciliation sweep within a day, because RevenueCat has no record of it.

**Approach:** Add a separate `ComplimentaryAccessGrant` table that billing code never reads or writes, and one read seam, `ComplimentaryAccessService.isActive`, that the premium check, the flag service and the community flag cache consult.
Give the owner an audited CLI to grant, revoke and list, and erase grants with the account.

Decisions (owner delegated planning to the builder, 2026-11-10):

- D1 Storage. New model `ComplimentaryAccessGrant`: `id`, `member_id` (FK `User`, `onDelete: Cascade`), `reason` (1 to 200 chars), `granted_by_id` (FK `User`, `SET NULL`), `granted_at`, `revoked_at?`, `revoked_by_id?` (FK `User`, `SET NULL`), `revoke_reason?` (1 to 200 chars).
  - A partial unique index allows one row with `revoked_at IS NULL` per member. Revoked rows stay as history.
  - `CHECK ((revoked_at IS NULL) = (revoke_reason IS NULL) AND (revoked_at IS NOT NULL OR revoked_by_id IS NULL))`, and `reason` and `revoke_reason` are 1 to 200 characters after trimming (TEA-11).
  - The partial unique index is raw SQL in the migration, as `20261024120000_community_post_sponsorship` does (TEA-19).
  - Worker-only like `PremiumEntitlement`: RLS on, zero policies, zero grants to `anon`, `authenticated`, `service_role`. Listed in `workerOnlyTables` and `packages/testing/src/cleanup.ts`.
  - Migration `20261110120000_complimentary_access`.
  - Rejected: a `promotional` row in `PremiumEntitlement`. `applyLedgerSnapshot` and the 15-minute reconciliation sweep upsert by `user_id` and would expire it, and the store enum's `promotional` already means RevenueCat's own grants.
- D2 One read seam. `apps/api/src/modules/feature-flags/complimentary-access.service.ts`, exported from `FeatureFlagsModule`, which commerce already imports.
  - It depends on `PrismaClient` and the remote provider only, and resolves the kill switch through `@couture/config` with the `FeatureFlag` row as fallback. It never injects `FeatureFlagsService`, which already injects `CommunityFlagEvaluationService` (TEA-05).
  - It is a required constructor argument at every hand-built site: `community-engagement.runtime.ts`, `workers/bootstrap.ts` (three sites), `workers/community.bootstrap.ts` (production push) and the integration support files (TEA-05).
  - `isActive(memberId): Promise<boolean>` reads the grant first and evaluates the kill switch only when a grant exists, for the fixed system subject `complimentary-access-kill-switch` (TEA-04).
  - Deadlines: in the community refresh the grant read runs under `budget.connection` and the kill switch under the invocation signal; elsewhere the kill switch gets a 500 ms remote deadline (TEA-04).
  - Any read error or timeout answers false and logs `complimentary_access_unavailable` with no member id. A grant can never fail open into another member's access.
  - Nothing caches the answer in process. Revoke takes effect on the member's next request.
- D3 Kill switch. New flag `complimentary_access_enabled`, `defaultValue: true`, seed true.
  - It is the one flag in `flags.ts` that defaults true besides `weather_alerts_enabled`. The comment states why: it can only widen access for members the owner granted, so a degraded PostHog turning it on harms nobody, and default true means grants work in production with no flag flip.
  - Off removes every complimentary effect, for incidents: premium and the five shortcut flags on the next request, and community read, realtime and push within 60 seconds, the cache row's lifetime (TEA-12).
- D4 Flags complimentary members receive as true, one exported constant `COMPLIMENTARY_MEMBER_FLAGS`:

  | Flag                              | Why                                 |
  | --------------------------------- | ----------------------------------- |
  | `premium_themes_enabled`          | Premium capability (5.3)            |
  | `color_analysis_enabled`          | Premium capability (5.4)            |
  | `premium_planner_enabled`         | Premium capability (5.5)            |
  | `community_read_enabled`          | Community rollout (6.1), push (6.5) |
  | `community_write_enabled`         | Community rollout (6.1)             |
  | `share_card_native_share_enabled` | Community sharing (6.9)             |
  - Not included: `commerce_subscription_enabled` and `commerce_affiliate_enabled` (purchasing and affiliate revenue), every `moderation_*` flag (operator roles), `weather_alerts_enabled` (already on).
  - `FeatureFlagsService.getFeatureFlag` checks the five keys other than `community_read_enabled` and `isActive` first and returns true, before PostHog. It reads grants only for those five keys. Every other member takes the unchanged path (TEA-02, TEA-16).
  - `community_read_enabled` stays out of that shortcut, so each member has one answer for read (TEA-02). It goes through `CommunityFlagEvaluationService`, whose cached row is what `readAuthorized`, realtime and the push send guard (`community-send-guard.ts:224`) read. `refresh` sets `value = true` when `isActive` is true, and otherwise asks PostHog as today. The "remote-only" comment is rewritten: the row now holds a remote answer or a complimentary answer, never a fallback default.
  - The fixture branch of `communityReadEvaluation` (`TEST_ENV=local`, `COMMUNITY_FLAG_FIXTURE_MODE=true`, used by every E2E stack and k6) reads the global row and skips the cache, so it asks `isActive` first (TEA-03).
  - Grant and revoke `DELETE` the member's `CommunityFlagEvaluation` rows after `community_privacy_guards(ARRAY[member], ARRAY[]::text[], false)`, as `community_forget_subject` does, inside the grant transaction. Nulling columns would leave `next_claim_at` up to 45 seconds ahead (a 503 after a grant) and an in-flight refresh lease that writes a pre-revoke true for 60 seconds (TEA-01).
  - `community_write_enabled` is also read for the author in `moderation-decisions.service.ts`, `community-moderation.actions.ts` and `community-moderation.processor.ts`. With the override, decisions and releases on a grantee's case stay open, as they do for any flag-on author (TEA-13).
  - The override never bypasses age, guardian consent, sanctions, erasure or the moderation pipeline. Those checks run after the flag and are unchanged.

- D5 Premium. `PremiumEntitlementService.hasPremiumAccess` returns true when the paid row is `active` or `grace_period`, or `isActive` is true. It reads the paid row first and asks `isActive` only when the row does not entitle (TEA-16). The guard, theme `isEntitled`, palette `isEntitled` and planner follow without edits.
  - No billing path reads the grant: webhooks, `applyLedgerEvent`, `applyLedgerSnapshot`, refresh and the reconciliation sweep stay byte-identical. A spec asserts none of their files name the grant model.
  - Checkout order: the purchasing-flag 503 first, the paid-active 409 second, then a complimentary member gets 409 with `COMPLIMENTARY_ACCESS_ACTIVE_MESSAGE` on the existing error envelope, mapped by web `premiumFailureReason`. Nobody is charged on web for what they already have. The portal is unchanged, so a member who also pays can still manage that subscription (TEA-07).
  - Mobile buys through the RevenueCat SDK on the device, which the server cannot refuse. Mobile hides purchase controls for `source: 'complimentary'`; a client that ignores that can still buy, and that residual is stated in the guide (TEA-07).
  - Revoke leaves `PremiumEntitlement` untouched, so the member's paid or free state is what the next request sees.
- D6 Client surface. `GET /api/v1/commerce/subscription` keeps its contract: web and mobile parse it with strict schemas, and an added key would break installed builds.
  - New `GET /api/v1/commerce/premium/access`, bearer only, `Cache-Control: private, no-store`: `{data:{premium:boolean, source:'subscription'|'complimentary'|'none'}}`. `complimentary` wins when both apply. Strict shared Zod schema in `packages/api-client/src/contracts/http/premium-access.ts`, registered in OpenAPI and the generated SDK.
  - Web `subscription-section.tsx` and mobile `settings.tsx` read it: a complimentary member sees a "Complimentary access" state with no subscribe or purchase control. A member who also pays sees the complimentary note and the subscription block with its portal link. A failed access read renders the section as today (TEA-14).
  - `Cache-Control: private, no-store` holds on 200, 401 and 500 (TEA-18).
  - Every other premium surface already renders from server `isEntitled` and per-member flags, so it opens with no client change. All ten web locales and the mobile locales, catalog parity, light and dark, WCAG 2.2 AA.
- D7 Owner-only grant and revoke. A CLI on the 6.7b sponsorship operator pattern: `npm run access:complimentary -- grant|revoke|list --env-file <path> --actor-email <email> [--member-email <email>] [--reason <text>] [--confirm-target <project ref>] [--dry-run]`.
  - Targeting copies 6.7b: `--env-file` is the only `DATABASE_URL` source, a remote host needs `--confirm-target <project ref>`, `--dry-run` rolls back, exit codes 0, 1, 2 (TEA-08).
  - Owner-only means two things together: the caller holds the production database credentials, and `--actor-email` resolves to an auth user whose `app_metadata.app_role` is `admin` (reuse `resolveAdminActor`). No HTTP route can grant or revoke.
  - `grant` writes the row and one `AuditLog` row `complimentary_access_granted` keyed by the actor, `event_data {grantId}`. A member with an active grant gets the refusal `already_granted` and no write.
  - `revoke` stamps `revoked_at`, `revoked_by_id`, `revoke_reason` and writes `complimentary_access_revoked` `{grantId}`. No active grant answers `no_active_grant`.
  - `list` prints active grants: grant id, member email, reason, granter email (`[erased]` when null), time.
  - Closed refusal codes: `actor_auth_user_missing`, `actor_not_admin`, `actor_app_user_missing`, `actor_identity_mismatch`, `actor_erasure_requested`, `member_not_found`, `member_erasure_requested`, `already_granted`, `no_active_grant`, `invalid_reason`. The sponsorship command's codes stay byte-identical (TEA-08, TEA-21).
  - Grant and revoke run in `communityPrivacyTransaction`. They take the actor's and the member's privacy guard and `community_member:` lock in sorted id order, in the erasure's lock order, before reading `ModerationErasureRequest` for either. An actor with a request is refused `actor_erasure_requested`; a member with one is refused `member_erasure_requested` (TEA-09, TEA-21).
  - A concurrent second grant maps the unique violation to `already_granted`; a concurrent second revoke answers `no_active_grant` from its update count. Neither writes an audit row (TEA-10).
  - Actor, member, reason and time live on the grant row; the immutable `AuditLog` row holds only the actor and the grant id, as 6.13 ruled that no member id enters `AuditLog`.
  - The write, the audit row and the flag-cache invalidation commit in one transaction.
- D8 Erasure. `requestAccountErasure` deletes every grant row for the member in its existing transaction, so the grant, its reason and the member link go at request time, inside the 72-hour schedule. It also nulls `granted_by_id` and `revoked_by_id` that name the member, so an erased operator leaves no identity on other members' grants (TEA-11). Audit rows keep only actor and an orphaned grant id. A member or actor with an erasure request cannot grant or be granted (D7). Deleting the `User` row cascades the member's grants and nulls the operator columns through the FK.
- D9 Production push. Push reaches complimentary members only when the community worker dispatches.
  - After merge, set `COMMUNITY_DISPATCH_ENABLED=true`, `COMMUNITY_ENGAGEMENT_OWNER=community` and `COMMUNITY_GUARD_DATABASE_URL` on the Northflank `couture-cast/community-worker`, and confirm `community_dispatch_readiness` logs `ready`.
  - The per-member flag row limits sends to complimentary members, because every other member's `community_read_enabled` is false in production.
  - Before the flip, a read-only count of pending `CommunityTokenDelivery` rows by status and expiry goes in the guide. After it, a non-grantee test delivery must end `suppressed` `no_call:read_disabled` (TEA-17).
  - If readiness is not `ready`, set `COMMUNITY_DISPATCH_ENABLED` back off, fix the cause, and record the outcome in the deployment guide. No value is printed in logs or committed.
- D10 Docs. The deployment guide gets a "Complimentary access" section: how to grant, revoke and list, the kill switch, the incident rule (closing a community flag does not close it for complimentary members; also turn off `complimentary_access_enabled`), and D9. The "with36" and "and32" typos in the 6.5 section are fixed.

## Boundaries & Constraints

**Always:**

- Contracts start as strict shared Zod schemas; controller, OpenAPI, generated SDK and both clients derive from them.
- Every complimentary read goes through `ComplimentaryAccessService.isActive`. One helper builds both audit rows.
- Paid entitlement keeps one writer, the RevenueCat webhook plus reconciliation.
- Tests that need the override run with community flags off globally, so a pass proves the override and not the seed.
- The complimentary E2E runs on its own owned runtime (the `scripts/e2e-share-card/prepare.mjs` pattern) with an isolated `DATABASE_URL`, `PLAYWRIGHT_SKIP_DB_RESET=true`, the six flag rows false, no PostHog key and one worker, with a non-grantee control in the same run. The shared E2E stack seeds the flags true and runs specs in parallel (TEA-15).

**Never:**

- A grant row in `PremiumEntitlement`, a RevenueCat or Stripe call, a customer record or a charge for a complimentary member.
- An HTTP route, console page or self-service path that grants or revokes.
- A member id, email or reason in `AuditLog`, logs or telemetry.
- Bypassing age, guardian consent, sanctions, erasure or screening for a complimentary member.
- A change to the subscription response contract, to global flag values in production, or to `bmad/`.

## I/O & Edge-Case Matrix

| Scenario                 | Input / State                                  | Expected Output / Behavior                                               | Error Handling                            |
| ------------------------ | ---------------------------------------------- | ------------------------------------------------------------------------ | ----------------------------------------- |
| Free member granted      | No paid row, grant active, flags off globally  | Premium routes 200, community feed and posting open, push dispatched     | N/A                                       |
| Paid member granted      | Paid `active`, grant active                    | Access unchanged, `source` complimentary, portal still works             | N/A                                       |
| Ledger sweep on grantee  | Reconciliation pulls null ledger for a grantee | Paid row handled as today; grant untouched; access stays                 | N/A                                       |
| Revoke, free member      | Grant revoked                                  | Next request: premium 403, feed 403 `denied`, posting 503, no push       | N/A                                       |
| Revoke, paid member      | Paid `active`, grant revoked                   | Next request: paid access as before                                      | N/A                                       |
| Kill switch off          | `complimentary_access_enabled` false           | Every grantee behaves as without a grant: feed 403 `denied`, posting 503 | N/A                                       |
| Grant lookup fails       | Database error in `isActive`                   | Treated as no grant; paid members unaffected                             | Logs `complimentary_access_unavailable`   |
| Other member             | No grant                                       | Byte-identical behavior to `main` for premium, flags and push            | N/A                                       |
| Complimentary checkout   | Grantee requests a checkout session            | No Stripe call                                                           | 409 `COMPLIMENTARY_ACCESS_ACTIVE_MESSAGE` |
| Non-admin actor          | `--actor-email` without `app_role: admin`      | No write                                                                 | `actor_not_admin`                         |
| Double grant             | Active grant exists                            | No write, existing grant id printed                                      | `already_granted`                         |
| Erasure                  | Member with grants requests erasure            | Grant rows gone at request; audit rows keep actor and grant id only      | Transaction rolls back as a whole         |
| Teen grantee             | Grantee under 16 without guardian consent      | Premium opens; community upload still refused by the consent gate        | Existing consent refusal                  |
| Revoked grantee's socket | Open realtime connection, grant revoked        | Socket closes on its next revalidation, under 7 seconds                  | N/A                                       |

</frozen-after-approval>

## Code Map

Verified against `main` at `63bd6fcd`.

- `packages/db/prisma/schema.prisma`: `PremiumEntitlement` (:1509, `user_id @unique`, mirror only), `AuditLog` (:1216, `user_id` required), `FeatureFlag` (:1231), `CommunityFlagEvaluation` (:2036). Latest migration `20261106120000_moderation_report_origins`. RLS pattern from `20260812090000_add_premium_subscription`.
- `packages/db/test/rls/harness.ts` (:85 `workerOnlyTables`), `packages/testing/src/cleanup.ts`: register the table.
- `apps/api/src/modules/commerce/premium-entitlement.service.ts`: `hasPremiumAccess` (:193) is the premium seam; `applyLedgerEvent` (:208), `applyLedgerSnapshot` (:280) must stay untouched. `billing-reconciliation.service.ts` (:180, :213), `billing-webhook.service.ts` (:629, :696-719), `subscription.service.ts` (:69, :119, :178): untouched.
- `apps/api/src/modules/commerce/stripe-billing.service.ts` (:84): checkout 409 for grantees.
- `apps/api/src/modules/commerce/premium-entitlement.guard.ts`, `premium-theme.service.ts` (:107), `palette-advisor.service.ts` (:147), `personalization/planner.controller.ts` (:50, :73): follow `hasPremiumAccess`, no edit expected.
- `apps/api/src/modules/feature-flags/feature-flags.service.ts`: `getFeatureFlag` (:85), override before `resolveFeatureFlag`. `community-flag-evaluation.service.ts`: `refresh` (:244), remote call (:267), cache write (:292).
- `apps/api/src/modules/community/community-send-guard.ts` (:170, :224): reads the cache row; no edit expected.
- `apps/api/src/modules/community/community.repository.ts`: `requestAccountErasure` (:613) deletes grants.
- `apps/api/src/modules/commerce/community-sponsorship-operator.service.ts` (`resolveAdminActor` :325), `community-sponsorship.cli.ts`, `scripts/community-sponsorship.ts`, root `package.json` (:21): operator pattern to copy; export `resolveAdminActor` to a shared helper.
- `packages/config/src/flags.ts`, `packages/config/src/flags.spec.ts`, `packages/db/prisma/seeds/feature-flags.ts`, `apps/api/src/modules/feature-flags/feature-flags.service.spec.ts`: new flag and count assertions.
- `packages/api-client/src/contracts/http/subscription.ts`: unchanged. New `premium-access.ts`; `openapi.ts`, `index.ts`, `packages/api-client/docs/http.openapi.json`, `src/generated/*` regenerate.
- `apps/api/src/modules/commerce/subscription.controller.ts`, `commerce-cache-headers.middleware.ts`: route pattern and cache header.
- Web: `apps/web/src/lib/premium.ts` (:164), `subscription-section.tsx` (:56), `apps/web/src/i18n/locales/*.json` (10).
- Mobile: `apps/mobile/src/lib/premium.ts` (:45), `app/(tabs)/settings.tsx` (:617), mobile commerce locales and `apps/mobile/src/i18n/commerce-locales.spec.ts`.
- `_bmad-output/project-knowledge/deployment-guide.md` (:960 6.5 dispatch controls).

## Tasks & Acceptance

**Execution:**

- [x] `packages/db/prisma/schema.prisma`, `packages/db/prisma/migrations/20261110120000_complimentary_access/migration.sql`, RLS harness, cleanup -- model, indexes, check, RLS -- D1.
- [x] `packages/config/src/flags.ts`, seeds, flag specs -- `complimentary_access_enabled` and `COMPLIMENTARY_MEMBER_FLAGS` -- D3, D4.
- [x] `apps/api/src/modules/feature-flags/complimentary-access.service.ts`, `feature-flags.module.ts`, `feature-flags.service.ts`, `community-flag-evaluation.service.ts` -- read seam, flag override, cache override -- D2, D4.
- [x] `apps/api/src/modules/commerce/premium-entitlement.service.ts`, `stripe-billing.service.ts` -- premium seam, checkout refusal -- D5.
- [x] `apps/api/src/modules/commerce/complimentary-access-operator.service.ts`, `complimentary-access.cli.ts`, `scripts/complimentary-access.ts`, `package.json`, shared admin-actor helper -- grant, revoke, list, audit, cache invalidation -- D7.
- [x] `apps/api/src/modules/community/community.repository.ts` -- erase grants -- D8.
- [x] `packages/api-client/src/contracts/http/premium-access.ts`, OpenAPI, generated SDK, `apps/api/src/modules/commerce/premium-access.controller.ts`, module and cache middleware -- access route -- D6.
- [x] Web and mobile premium clients, subscription section, settings, locales -- complimentary state -- D6.
- [x] Tests per the TEA plan below, red first -- AC 4.
- [x] `_bmad-output/project-knowledge/deployment-guide.md`, `sprint-status.yaml` -- D9, D10.
- [ ] Post-merge: D9 on Northflank, then one real grant for a test account in production and a revoke, read back through `list`.

**Acceptance Criteria:**

- Given a free member with an active grant and every community flag off globally, when they call the theme, palette, planner, feed, post and share-capability routes, then each answers as for an entitled, flag-on member.
- Given a grantee and a non-grantee who both opted into push, when engagement on their posts dispatches, then only the grantee's delivery is sent.
- Given a grant, when the RevenueCat webhook, refresh or reconciliation sweep runs for that member, then the grant row is unchanged and access remains.
- Given the CLI with a non-admin actor or no production credentials, when grant or revoke runs, then nothing is written.
- Given a grant or revoke, when it commits, then exactly one `AuditLog` row exists for it with the actor and grant id and no member identity.
- Given a revoked grantee, when they make their next request, then premium, community and push behave exactly as before the grant.
- Given a grantee requests erasure, when the erasure transaction commits, then no grant row references them and the audit rows hold no member identity.
- Given the PR, when CI runs, then every gate is green and the changed files stay at or under 100.

## Implementation Notes

- Constructor wiring follows TEA-05 exactly: `CommunityFlagEvaluationService(prisma, remote, complimentary)`, `FeatureFlagsService(repository, remote, communityCache | undefined, complimentary)` and `PremiumEntitlementService(..., complimentary)`, all required. Suites that never grant take `apps/api/integration/helpers/no-complimentary-grants.ts`; the engagement harness and forked worker build the real seam.
- `ComplimentaryAccessService.check` returns `granted`, `not_granted` or `unavailable`; `isActive` wraps it. The community refresh does not cache a `false` that rests on `unavailable` (review finding 8).
- The 6.7b admin check and command targeting moved, unchanged, to `operator-actor.ts` and `operator-cli-target.ts`; the sponsorship command re-exports its old names and keeps its codes.
- Checkout's complimentary 409 uses the message constant `COMPLIMENTARY_ACCESS_ACTIVE_MESSAGE` on the shared error envelope, which has no code field.
- `premiumAccessSchema` is a discriminated union on `source`, so `premium` cannot contradict it (TEA U-C-STRICT). OpenAPI moves to 1.8.0.
- Owner ruling, 2026-11-10: one PR even over 100 files; the Acceptance line on file count is waived.
- Mobile waits for the access read before configuring RevenueCat, and holds the section in loading until it settles.

## Plan Change Log

2026-11-10, TEA review against `63bd6fcd`. Evidence for each entry, with file and line, is in the Spec review section of `_bmad-output/test-artifacts/test-design/cc614-complimentary-access-test-design.md`.
TEA did not edit the frozen block. Entries marked (intent) change or extend a frozen decision or matrix row; the builder applies them there.

- TEA-01 (intent), D4: grant and revoke `DELETE` the member's `CommunityFlagEvaluation` rows after `community_privacy_guards(ARRAY[member], ARRAY[]::text[], false)`, as `community_forget_subject` does. Nulling `remote_value` and `expires_at` leaves `next_claim_at` up to 45 s ahead, so the grantee gets 503 after a grant, and leaves an in-flight `refresh_owner`, whose guarded update writes a pre-revoke true valid for 60 s.
- TEA-02 (intent), D4: `community_read_enabled` stays out of the `getFeatureFlag` shortcut and reaches the override only through the cache refresh and the fixture branch. The shortcut covers the other five. One answer per member for read.
- TEA-03 (intent), D4: the fixture branch of `communityReadEvaluation` (`TEST_ENV=local`, `COMMUNITY_FLAG_FIXTURE_MODE=true`, used by every E2E stack and k6) reads the global row and skips the cache. It asks `isActive` first.
- TEA-04 (intent), D2, D3: `isActive` reads the grant first and evaluates the kill switch only when a grant exists, for the fixed system subject `complimentary-access-kill-switch`. In the community refresh the grant read runs under `budget.connection` and the kill switch under the invocation signal; elsewhere the kill switch gets a 500 ms remote deadline. A timeout or error counts as no grant and logs `complimentary_access_unavailable`.
- TEA-05 (intent), D2: `ComplimentaryAccessService` depends on `PrismaClient` and the remote provider and resolves the kill switch through `@couture/config` with the `FeatureFlag` row as fallback, because `FeatureFlagsService` already injects `CommunityFlagEvaluationService`. It is a required constructor argument at every hand-built site: `community-engagement.runtime.ts:140`, `workers/bootstrap.ts:228`, `:320`, `:346`, `workers/community.bootstrap.ts:144`, and the integration support files.
- TEA-06 (matrix): "Revoke, free member" and "Kill switch off" read "feed 403 `denied`, posting 503" (`community.service.ts:428`, `:463`).
- TEA-07 (intent), D5: checkout keeps the purchasing-flag 503 first and the paid-active 409 second; the complimentary 409 comes third, on the existing error envelope, mapped by web `premiumFailureReason`. Mobile buys through the RevenueCat SDK on the device, which the server cannot refuse; mobile hides purchase controls for `source:'complimentary'`, and the residual is stated.
- TEA-08 (intent), D7: the closed refusal list uses the helper's real codes, `actor_auth_user_missing`, `actor_not_admin`, `actor_app_user_missing`, `actor_identity_mismatch`, in place of `actor_not_found`, and the sponsorship command's codes stay byte-identical. The CLI copies 6.7b targeting: `--env-file` is the only `DATABASE_URL` source, a remote host needs `--confirm-target <project ref>`, `--dry-run`, exit codes 0, 1, 2.
- TEA-09 (intent), D7, D8: grant runs in `communityPrivacyTransaction` and takes the member's guard and `community_member:` lock in the erasure's order before reading `ModerationErasureRequest`, so a grant cannot outlive a racing erasure.
- TEA-10, D7: a concurrent second grant maps the unique violation to `already_granted`; a concurrent second revoke answers `no_active_grant` from its update count. Neither writes an audit row.
- TEA-11 (intent), D1, D8: `requestAccountErasure` nulls `granted_by_id` and `revoked_by_id` that name the member. The D1 check becomes `CHECK ((revoked_at IS NULL) = (revoke_reason IS NULL) AND (revoked_at IS NOT NULL OR revoked_by_id IS NULL))`. `list` prints `[erased]` for a null granter.
- TEA-12, D3, D10: a kill-switch flip reaches premium and the five shortcut flags on the next request, and community read, realtime and push within 60 s, the cache row's lifetime. D3's "at once" and the guide's incident rule say so.
- TEA-13, D4: `community_write_enabled` is also read for the author in `moderation-decisions.service.ts:303`, `community-moderation.actions.ts:101` and `community-moderation.processor.ts:570`. With the override, decisions and releases on a grantee's case are open. D4 states it.
- TEA-14, D6: an access-route failure renders the client section as today; paid plus complimentary shows the complimentary note and the subscription block with its portal; no subscribe or purchase control for `source:'complimentary'`.
- TEA-15, Boundaries: the complimentary E2E runs on its own owned runtime (the `scripts/e2e-share-card/prepare.mjs` pattern) with an isolated `DATABASE_URL`, `PLAYWRIGHT_SKIP_DB_RESET=true`, the six flag rows false, no PostHog key and one worker, and a non-grantee control in the same run. The shared E2E stack seeds the flags true and runs specs in parallel.
- TEA-16, D2, D5: `hasPremiumAccess` reads the paid row first and asks `isActive` only when it does not entitle; `getFeatureFlag` reads grants only for the five shortcut keys.
- TEA-17, D9: before setting `COMMUNITY_DISPATCH_ENABLED=true`, a read-only count of pending `CommunityTokenDelivery` rows by status and expiry goes in the guide; after it, a non-grantee test delivery must end `suppressed` `no_call:read_disabled`.
- TEA-18, D6: the access route's `Cache-Control: private, no-store` is asserted on 200, 401 and 500.
- TEA-19, D1: the partial unique index is raw SQL, after `20261024120000_community_post_sponsorship`.
- TEA-20 (matrix): new row. A revoked grantee's open realtime socket closes on its next revalidation, under 7 s.
- TEA-21 (intent), D7, D8: grant and revoke refuse an actor with a `ModerationErasureRequest` as `actor_erasure_requested` (new closed code), and take both the actor's and the member's guard and lock in sorted id order first. Otherwise an admin with a pending erasure can still act, and a late grant writes their id back after TEA-11 nulled it.
- TEA-22, D6, D7 (build, slices 1 to 5): `premiumAccessSource` reads the grant for a paying member too, because `complimentary` wins; that read is accepted and limited to the access route and checkout. The D1 reason checks use `btrim(x, E' \t\r\n')`, so a reason of only tabs or newlines is refused like the CLI's `trim()` refuses it. In the community refresh, the grant read and the kill switch get a sub-deadline that leaves the remote call its time, so a hanging grant read or kill switch counts as no grant (`U-REFRESH-BOUNDED`, `I-KILL-REMOTE-SLOW`).
- TEA-23 (build, slices 9 to 11): a non-grantee's delivery is suppressed by `dispatch` before any attempt row, so it ends `suppressed` with no attempt and no reason; `no_call:read_disabled` appears only when the in-transaction recheck flips. D9's post-merge check looks for `suppressed` with zero attempts. Mobile configures the RevenueCat SDK only after the access read settles and never for a complimentary member, and purchase controls stay hidden until then (`M-HIDE-PURCHASE`, `M-NO-FLASH`). The Pact provider mounts `PremiumAccessController`, and the premium double answers `premiumAccessSource` from its own provider state.

## Review Triage Log

Pass 1, quick lens, 2026-11-10: 17 findings. 11 patch, 3 rejected, 3 in flight (TEA).

| #   | Finding                                               | Verdict | Route and evidence                                                       |
| --- | ----------------------------------------------------- | ------- | ------------------------------------------------------------------------ |
| 1   | Changed files over 100                                | false   | Owner ruling: one PR over 100 files is fine                              |
| 2   | E2E owned runtime missing                             | false   | TEA slice 12 in progress when the diff was cut                           |
| 3   | Seeded-defect directory missing                       | false   | TEA S-1 to S-21 running when the diff was cut                            |
| 4   | Guide push outcome contradicts TEA-23                 | medium  | patch: guide states suppressed with zero attempts                        |
| 5   | D9 steps missing from the guide                       | medium  | patch: count, readiness, non-grantee check, rollback added               |
| 6   | Kill switch slower than 60 s, guide silent on how     | medium  | patch: remote gets 80% of half the window; guide covers PostHog plus row |
| 7   | `flags.ts` comment says "at once"                     | low     | patch: comment states the two bounds                                     |
| 8   | Slow grant read caches false for 60 s                 | medium  | patch: `check` tri-state; refresh releases the claim instead             |
| 9   | Kill-switch fallback read outside the connection gate | medium  | patch: fallback row read goes through `runGrantRead`                     |
| 10  | Web hides grace banner from a paying grantee          | medium  | patch: notes render when entitled                                        |
| 11  | Mobile keeps previous account's access answer         | medium  | patch: sign-out resets access and settle state                           |
| 12  | Mobile shows free or ended state before access lands  | low     | patch: resolver stays loading until access settles                       |
| 13  | Push proof uses a stub in the harness                 | medium  | patch: harness and forked worker build the real seam                     |
| 14  | `revoked_at` from the app clock                       | low     | patch: grant and revoke times from the database clock                    |
| 15  | Guide lines over 100 characters                       | low     | patch: section rewrapped                                                 |
| 16  | Tracking status disagrees                             | low     | patch: ticked at completion                                              |
| 17  | TEA-23 vs guide (same as 4)                           | n/a     | merged with 4 by shared root cause                                       |

## Test Design (TEA)

Full plan, reconciled to this spec (this spec wins on any disagreement):
`_bmad-output/test-artifacts/test-design/cc614-complimentary-access-test-design.md`.
20 risks (9 high, one at score 9 until TEA-03 and TEA-15 are built and proved); 141 scenarios: P0 105, P1 33, P2 3 (DB 12, Unit 42, Integration 53, API 16, Contract 4, Component 8, E2E 4, Manual 2).
131 are red-first, 8 are green guards and 2 are manual.
21 seeded-defect proofs (S-1 to S-21) run in a throwaway worktree and are recorded under `_bmad-output/test-artifacts/story-6-14/`.
Review findings TEA-01 to TEA-21 are in the Plan Change Log.

Red-first order for the build:

1. Migration and harness, with `D-*` red.
2. Config, with `U-FLAG-DEFAULT` and `U-FLAG-LIST-EXACT` red.
3. Read seam, with `U-ISACTIVE-*`, `U-KILL-*`, `U-NO-CACHE` red.
4. Wiring, with `U-WIRE-*` red before any constructor changes.
5. Flag service and cache, with `U-SHORTCUT-*`, `U-FIXTURE-OVERRIDE`, `U-REFRESH-*` red, then `I-OVERRIDE-*` and `I-CACHE-*`. `I-CACHE-REVOKE-INFLIGHT` comes before the invalidation code.
6. Premium seam, with `U-PREMIUM-*`, `U-CHECKOUT-ORDER`, `I-SWEEP-KEEPS`, `I-WEBHOOK-KEEPS` red.
7. Operator, with `U-CLI-*`, `I-CLI-*`, `I-AUDIT-EXACT` red. `U-ADMIN-HELPER-SPONSORSHIP` is green before and after the helper extraction.
8. Erasure and lifecycle, with `I-ERASE-*`, `I-CLI-ACTOR-ERASURE` and `L-*` red. `I-ERASE-RACE-GRANT` and `I-ERASE-RACE-GRANTER` first.
9. Contract and route, with `U-C-*` and `A-ACCESS-*` red, then `A-AC1-*`.
10. Push, with `I-PUSH-*` red.
11. Clients, with `W-*` and `M-*` red against contract fixtures.
12. Pact, then the owned E2E runtime and `E-*` last. `E-FREE-OPENS` beside `E-CONTROL-LOCKED` is the final proof.
13. Guide and sprint status, then `X-DISPATCH` and `X-PROD-GRANT` after merge.

Green guards that start passing: `D-MIG-HYGIENE`, `U-COMMENT-REMOTE-ONLY`, `U-PORTAL-UNCHANGED`, `U-ADMIN-HELPER-SPONSORSHIP`, `U-C-SUBSCRIPTION-FROZEN`, `A-CHECKOUT-503`, `C-SUBSCRIPTION-UNCHANGED`, `G-BILLING-UNTOUCHED`.

Build rules the tests rely on:

- Every override proof runs with the six flags false in its own database and asserts a non-grantee control in the same test.
- The fake remote provider records every `(flagKey, subjectId)` call.
- The refresh exposes a seam between the grant read and the cache write, so a test can pause it. Races are forced by polling `pg_stat_activity` for the lock wait, in both orders, with no sleeps.
- One helper builds both audit rows. One factory creates the admin with its `auth.users` row.
- Cleanup deletes users and lets the foreign keys act.

What the tests can and cannot prove: the override, the races and erasure are proved on real Postgres with the flags off. Push is proved through the worker-built evaluator in the engagement harness; the production push path stays unproven until `X-DISPATCH`. The kill switch's 60 s community bound is proved by backdating `expires_at`. A store purchase on a device by a grantee is a stated residual (TEA-07).

## Verification

**Commands:**

- `npm exec -- vitest run` in `apps/api`, `packages/db`, `packages/api-client`, `packages/config`, `apps/web`, `apps/mobile` for touched specs -- expected: green.
- `npm exec -- tsc --noEmit -p <tsconfig>` in every touched workspace, counted by code -- expected: only the known symlink TS2742.
- `DATABASE_URL=<isolated database> NODE_OPTIONS=--conditions=development npm exec -- vitest run integration` in `apps/api` for `complimentary-*`, `premium-*`, `billing-*`, `community-*flag*`, `community-send-guard*` -- expected: green.
- `DATABASE_URL=<isolated database> PLAYWRIGHT_SKIP_DB_RESET=true npx playwright test` for the complimentary spec -- expected: green.
- `git diff --name-only main | wc -l` -- expected: at most 100.

**Manual checks:**

- Real stack, isolated database, community flags off: grant a test member with the CLI, sign in on web and mobile, confirm premium surfaces, feed, posting and the "Complimentary access" state in light and dark, desktop and mobile widths; revoke and confirm the locked state on the next request.

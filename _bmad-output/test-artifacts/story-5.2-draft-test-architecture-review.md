<!-- markdownlint-disable MD013 -->

# Story 5.2 draft — test-architecture review (pre-dev)

**Reviewer:** Murat, Master Test Architect (bmad-tea)
**Date:** 2026-08-12
**Artifact:** `_bmad-output/implementation-artifacts/5-2-premium-subscription-lifecycle.md` (first draft, baseline `0183954`)
**Scope:** test requirements in Tasks 1-10 and the testability of the ACs. Requirements/architecture drift is the parallel reviewer's lane (`5-2-review-log.md`); overlap is noted, not duplicated.
**Method:** risk-based (P×I, 1-9); webhook boundaries default P2×I3=6 per the TEA webhook-risk framework. Findings only — no story edits.

## Verdict

The draft is unusually strong on inherited discipline (idempotency boundaries, RLS registration, three-registry analytics, Pact determinism gate, absolute k6 SLOs). The gaps cluster where billing is genuinely different from story 5.1's affiliate webhook: **money-bearing events that arrive out of order, transfer between users, or fail to forward between providers**. Two findings are high-risk (score 6); I'd want both specified in the story before dev starts, not discovered during it.

## High-risk findings (score ≥ 6 — specify before dev)

### F1 — Stripe→RevenueCat forward failure is an unrecoverable dropped payment as specified (P2×I3 = 6, DATA/BUS)

Decision 4: web entitlement truth flows `checkout.session.completed` → our API → forward to RevenueCat → RC webhook → `PremiumEntitlement`. Single-writer is right. But if the forward call fails (RC outage, 5xx, our crash between Stripe ack and forward), the design has no recovery: the refresh endpoint pulls **from RevenueCat**, which never learned about the subscription, so refresh can't heal it; the reconciliation cron reads RC too. A paying web customer stays un-entitled forever, silently.

**Required:** persist the forward obligation before acking Stripe (the `CapsuleTelemetryClaim` outbox pattern at `schema.prisma:714-735` is the in-repo template, or a `forwarded_at`/`forward_attempts` pair on the Stripe `BillingEvent` row), and make the reconciliation cron re-drive unforwarded events. Tests: (a) forward fails → Stripe webhook still 200s and the event row records the pending state; (b) cron re-forward succeeds → entitlement activates; (c) forward is idempotent on RC's side (same fetch token twice ≠ two subscriptions).

### F2 — The fake Stripe client must not fake signature verification (P2×I3 = 6, SEC)

Decision 9's `resolveStripeClient()` double is right for outbound calls (`checkout.sessions.create`, `billingPortal.sessions.create` — network, nondeterministic). But if the double also swallows `webhooks.constructEvent`, the entire signature-verification branch — the webhook's _only_ authentication — ships tested against a stub. `constructEvent` is pure local HMAC: tests can and must run the **real** stripe library, signing fixtures with the test-only `STRIPE_WEBHOOK_SECRET` (`stripe.webhooks.generateTestHeaderString` exists for exactly this). Scope the fake to outbound API calls explicitly in Decision 9, and require the integration suite to prove: valid signature 200, tampered body 401, stale timestamp 401, wrong secret 401 — over HTTP with `rawBody`, mirroring 5.1's suite.

## Medium findings (score 4-5 — resolve during Task specification, cheap now, expensive later)

### F3 — Equal-`occurred_at` events have no winner (P2×I2 = 4)

Decision 8 mandates a strictly-greater `occurred_at` guard with both boundary sides tested — good, but _equal_ is a real case (RevenueCat emits `RENEWAL` and `PRODUCT_CHANGE` pairs with identical timestamps at period boundaries). Strictly-greater silently drops the second event. Define the tie-break (provider event id as secondary comparator, or event-type precedence) and add the equal-timestamp test to Task 5's boundary set.

### F4 — `TRANSFER` semantics are named but undefined (P2×I2 = 4)

Decision 4 lists `TRANSFER` in the event map with no transition. A transfer moves the entitlement between `app_user_id`s — **two** users change state on **one** webhook, and `PremiumEntitlement.user_id` is `@unique`. Specify: deactivate the losing user (new status? `revoked` fits), upsert the winner, both in one transaction, two audit rows, and the case where the losing user doesn't exist locally. Without this a dev agent will guess, and every guess but one corrupts entitlement state.

### F5 — Deferred purchases ("Ask to Buy") are unhandled in a 13+ product (P2×I2 = 4)

This app's first persona is a teen. On iOS, a teen's purchase routinely enters StoreKit's _deferred_ state pending guardian approval — the SDK returns neither success nor cancel, and the entitlement arrives hours later via webhook. Task 6's purchase-wrapper state machine must enumerate: success, user-cancelled, SDK-unavailable (Expo Go), **deferred/pending**, and error — with copy for the pending state and a unit test each. The post-purchase 2-minute poll must not spin on a deferred purchase.

### F6 — The 2-minute AC is not falsifiable as one test; decompose it or someone will write a sleep (P2×I2 = 4)

"Reflects active within 2 minutes" spans provider latency we cannot test in CI. The draft implies the decomposition but never states it as test requirements. Make it explicit: (a) integration — webhook receipt → status endpoint reflects the transition in the **same** request cycle (synchronous write, no queue); (b) integration — refresh endpoint returns updated state on demand; (c) mobile unit — the post-purchase poll is bounded (fake timers: poll interval, 2-minute cap, terminal "still processing" state); (d) provider webhook latency is a monitoring concern, stated as untested. Ban wall-clock sleeps in all four.

### F7 — Unknown-subject webhooks must record, not throw (P2×I2 = 4)

`BillingEvent.user_id` is `SetNull`-nullable by design, but no task demands the negative tests: RC event for an `app_user_id` that no longer exists (deleted account), Stripe event for an unknown customer. Both must 200, record with `user_id: null`, skip the entitlement write, and not emit `api_error_occurred`. One test each in Task 4/5.

## Low findings (score ≤ 3 — worth a line each in the story)

- **F8 — Transition-table test.** Four statuses × eight event types wants one table-driven unit spec (from-state, event → to-state, side effects), not anecdotal per-event tests. Grace-period-keeps-access gets asserted once in the guard suite, once here.
- **F9 — HTTP-level cross-user authz.** The RLS actor matrix covers Supabase clients; it does not cover our API. Add one supertest: user A's token can never read user B's subscription (the endpoint takes no id parameter — assert that stays true by contract, i.e. no `userId` query param sneaks in).
- **F10 — Playwright checkout redirect will flake if it really navigates.** `checkout.stripe.test` doesn't resolve. Assert the API response URL or intercept the navigation (network-first discipline); never let the browser actually leave for a `.test` host.
- **F11 — Keep `refresh` out of k6.** It calls RevenueCat (real or fake) per hit. The SLO key covers `GET /subscription` only; say so where the k6 task is specified, or a load run becomes an RC hammer.
- **F12 — Pact scope mirrors usage.** Mobile never calls portal-session or checkout-session (web rails); don't write mobile-consumer interactions for them. The four provider states listed are sufficient; portal-404 needs the "active entitlement via app_store, no Stripe profile" arrangement — reachable with the listed states plus factory overrides, worth one sentence.
- **F13 — Guard's supertest fixture controller must be test-scoped.** The dormant `PremiumEntitlementGuard` is proven via a fixture route; require it registered in the `TestingModule` only, never in `CommerceModule`, and assert the prod route table doesn't grow.
- **F14 — Reconciliation cron needs its own drift test.** Local `active`, RC says `expired` → downgrade + audit row; and the cron body is crash-isolated (a throw can't kill sibling crons — 5.1's retention wrapper pattern).

## What the draft already gets right (no action)

Idempotency by `(provider, external_event_id)` with P2002-as-replay; uniform 401s on both webhooks; rawBody on all three bootstrap classes; worker-only RLS for entitlement tables (the privilege-escalation reasoning is exactly right); allowlisted receipt projection with negative fixtures; three-registry analytics with set-equality enforcement; absolute k6 SLOs in both config branches; Pact one-interaction-per-test + three-run determinism; per-flow Maestro scripts with an honest statement of what Maestro cannot verify for IAP; the integration-isolation note (file-private event-id namespaces) — that one saved 5.1 a rewrite.

## Disposition recommendation

Fold F1-F7 into the story before `dev-story` (F1 and F2 are blocking-grade; F3-F7 are one paragraph each). F8-F14 can land as task-line edits. Nothing here challenges the story's architecture — that's the other reviewer's brief — but F1 is the one place where the _test_ lens exposes a _design_ hole: the single-writer ledger has a write path with no retry, and only the test plan notices, because only the test plan asks "what fails?"

---
baseline_commit: 0e22a7c62ebe0de888c18bf8b351924d0032fe8e
---

<!-- markdownlint-disable MD013 MD024 MD036 -->

# Story 5.2: Premium subscription lifecycle

Status: done

**Story key:** `5-2-premium-subscription-lifecycle` · **Epic:** 5 — Commerce & Premium Enhancements (Phase 2)
**Baseline commit:** `0183954` (branch tip == `main` after story 5.1, PR #124, and the RLS falsifiability fix, PR #125)
**Prepared:** 2026-08-12 by the create-story workflow (Claude Fable 5), from exhaustive analysis of `epics.md`, `prd.md`, `architecture.md`, the UX spec, story 5.1 (`5-1-affiliate-shop-this-look-cta.md`, now `done`), its review log, `deferred-work.md`, the live codebase, and mid-2026 billing-platform research.

## Story

As a user,
I want to subscribe on mobile/web so that I can unlock advanced styling.

(Verbatim from `epics.md:429-430`. Do not widen it.)

## Traceability: epic AC → story AC

Story 5.1's review process (R3 F-1) established that every story AC must trace to an epic AC or carry an explicit derivation reason. Same discipline here.

| Epic AC (`epics.md:433-435`)                                                                    | Story AC                         | Kind                                                                                                                                                                                                                                                                     |
| ----------------------------------------------------------------------------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1. Integrate App Store / Play billing + web Stripe checkout with entitlement sync ≤2 minutes.   | AC 1, AC 2                       | source                                                                                                                                                                                                                                                                   |
| 2. Support upgrade, downgrade, and cancellation flows with receipts stored securely.            | AC 3                             | source                                                                                                                                                                                                                                                                   |
| 3. Gate Premium-only surfaces (7-day planner, themes, palette analysis) with entitlement check. | AC 4                             | source (scoped — see Decision 2)                                                                                                                                                                                                                                         |
| —                                                                                               | AC 5 (kill switch)               | derived: operator-managed billing with no admin console needs a safe degradation path; identical reasoning to 5.1 AC 6, recorded in its traceability table                                                                                                               |
| —                                                                                               | AC 6 (analytics funnel)          | derived: PRD Business Metrics require the premium convert funnel (`prd.md:60`, amended 2026-08-12: ≥ 8% of checkout starts convert; trial leg removed per Open question 2); without registered events the metric is uncomputable (the exact failure 5.1's R3 D-2 caught) |
| —                                                                                               | AC 7 (disclosure + localization) | derived: PRD NFR Security 4 (`prd.md:257`) requires third-party disclosure and opt-in/out in settings; PRD Success Criteria require localized commerce disclosures (`prd.md:40`)                                                                                         |
| —                                                                                               | AC 8 (RLS + data protection)     | derived: repo convention — every new table must register in the RLS matrix (`packages/db/test/rls-policies.spec.ts`), and entitlement rows are privilege-bearing (a client-forgeable entitlement row is free Premium)                                                    |

No epic AC is orphaned.

## Acceptance Criteria

1. **Mobile purchase and sync.** A signed-in user on iOS/Android can purchase the Premium subscription through App Store / Play billing via the RevenueCat SDK (`react-native-purchases`). After the store confirms the purchase, `GET /api/v1/commerce/subscription` reflects `status: 'active'` within 2 minutes, via the RevenueCat webhook and, as an on-demand guarantee, the authenticated refresh endpoint. Purchase, restore-purchases, and manage-subscription entry points exist in the mobile settings Premium section.
2. **Web purchase and sync.** A signed-in web user can subscribe via Stripe Checkout (`mode: 'subscription'`) launched from the web settings Premium section. `checkout.session.completed` is verified on the raw body, the subscription is forwarded to RevenueCat (single entitlement ledger), and the same `GET /api/v1/commerce/subscription` endpoint reflects `active` within 2 minutes.
3. **Lifecycle and receipts.** Upgrade and downgrade between `premium_monthly` and `premium_annual`, and cancellation, work on both rails: store-managed on mobile (subscription group / Play subscription update, surfaced through RevenueCat), Stripe Customer Portal on web. Every provider event lands as an append-only `BillingEvent` row — unique `(provider, external_event_id)`, allowlisted payload fields only, no PAN/email/free text, user link `onDelete: SetNull` so financial facts survive account erasure — and drives the `PremiumEntitlement` transition the Decision 4 table defines (cancellation keeps access until period end: `will_renew: false`, status stays `active`; `EXPIRATION` performs the downgrade) plus an `AuditLog` row. `BillingEvent` rows are pruned at 24 months by the commerce retention job, exempt from telemetry pruning (retention horizon signed off 2026-08-12; Open question 4, resolved).
4. **Entitlement gating.** `PremiumEntitlementService` + `PremiumEntitlementGuard` (API, 403 with `PREMIUM_REQUIRED_MESSAGE`) and client helpers (`apps/web/src/lib/premium.ts`, `apps/mobile/src/lib/premium.ts`) exist and are contract-tested. The one Premium surface that exists today — the web `PlannerRail` shell — renders a locked upsell state for non-entitled and signed-out users and its current shell for entitled users, proven over HTTP + Playwright. CC-5.3/5.4/5.5 consume the same check for themes, palette analysis, and the real planner.
5. **Kill switch.** `commerce_subscription_enabled` (default `false`, seeded on via `allowsCommerceSeeding()`) gates purchasing, through one server-side mechanism: checkout-session creation returns `503` + `COMMERCE_SUBSCRIPTION_DISABLED_MESSAGE` when off, and `GET /subscription` carries a server-evaluated `purchasesEnabled: boolean` that both clients read before rendering any subscribe control (this is the mobile half's mechanism — no client-side flag path exists in this repo, so the flag rides the status response). Webhooks always record; the status endpoint, refresh, and Customer Portal always work — a paying user must always be able to see and cancel their subscription.
6. **Analytics funnel.** Events `premium_subscribe_tapped` (client-side, mobile + web, client `distinctId`), `premium_checkout_started`, `premium_entitlement_activated`, `premium_entitlement_deactivated` (server-side, HMAC `analyticsSubjectId`, in `PSEUDONYMOUS_EVENT_TYPES`) are registered in all three analytics registries with property allowlists (product id and store enum allowed; no price, no receipt ids, no URLs). Emission points are exact: `premium_checkout_started` fires on checkout-session creation (web-only by construction — the mobile funnel start is `premium_subscribe_tapped`); `premium_entitlement_activated` fires on transitions into `active` from absent/`expired`/`revoked` and on `TRANSFER`-gain; `premium_entitlement_deactivated` fires on transitions into `expired` or `revoked`, carrying a `reason` property; `grace_period` entry/exit fires neither. **Funnel honesty:** the computable convert funnel lives in the server event space (`premium_checkout_started` → `premium_entitlement_activated` for web; store-attributed activations for mobile). Client `distinctId` and the server HMAC subject are disjoint identifier spaces with no join — `premium_subscribe_tapped` is directional volume, not a funnel leg, and this story says so rather than implying otherwise. The PRD's trial leg was removed by Open question 2's resolution (no trial at launch; `prd.md:60` amended 2026-08-12).
7. **Disclosure and localization.** The settings disclosure (both surfaces) is extended to name RevenueCat and Stripe as processors and what is shared (account id, purchase state; never card numbers). All new strings ship in all ten locale catalogs on both surfaces with new parity specs (`premium-locales.spec.ts` per surface); non-English strings are explicit machine-translation drafts pending human review before release (PRD NFR Localization 1), tracked as a release blocker exactly as 5.1's Decision 16 did.
8. **RLS and data protection.** `PremiumEntitlement`, `BillingEvent`, and `BillingCustomer` enable RLS with **zero client policies and zero grants** — a Supabase client must not be able to read or forge entitlement state; all access flows through the API. The correct spec template is the **5.1 commerce worker-only block at `rls-policies.spec.ts:2684-2753`**, including its behavioral 42501-rejection test (the `5.1-DB-007` pattern — PR #125's falsifiability standard requires the observable-behavior check, not just permission-state assertions). Do not touch the `privateTables` const at `:738`; that is the alert-tables test's local fixture, and worker-only tables are deliberately absent from `targetTables` (`:651-657`). Migration template: `20260811090000_add_commerce_affiliate/migration.sql:284-297`. The three tables are registered in `SeededScenario`, cleanup, factories, and the cleanup delegate list, and the full RLS actor matrix passes in CI.

## Decisions

### Decision 1 — Billing architecture: RevenueCat entitlement ledger + Stripe web checkout

**The stack:**

- **Mobile:** `react-native-purchases` (RevenueCat) v10.x (v10.7.0 as of 2026-08-06). Uses StoreKit 2 on iOS and Play Billing Library 8 on Android — which satisfies Google's hard deadline that all app updates ship Billing 8+ by 2026-08-31. Expo: works with prebuild/EAS dev builds (`expo-dev-client`); no purchases in Expo Go (SDK "Preview API Mode" returns mocks — the mobile Premium section must render a graceful "purchases unavailable in this build" state when the native module is absent).
- **Web:** `stripe` (stripe-node) v22.x, pinned API version `2026-07-29.dahlia`. Stripe Checkout (`mode: 'subscription'`) for purchase; Stripe Customer Portal for cancel/upgrade/downgrade — do not hand-build plan-switch UI.
- **Entitlement ledger:** RevenueCat, entitlement id `premium`, `app_user_id` = our `User.id` (cuid). Web subscriptions are forwarded to RevenueCat via its Stripe integration — `POST /v1/receipts` with `fetch_token` = the Stripe subscription id, platform `stripe`, after `checkout.session.completed` — so RevenueCat holds entitlement truth for all three stores (`app_store`, `play_store`, `stripe`). Precision matters here: the honest claim is **one entitlement writer** (the RevenueCat webhook is the only thing that writes `PremiumEntitlement` from provider events), not "one channel" — the full machinery is two webhook endpoints, the forward outbox, the REST client, and the reconciliation job.
- **Webhook auth:** RevenueCat offers HMAC-SHA256 payload signing (`X-RevenueCat-Webhook-Signature`, timestamped, raw-body) alongside the legacy static `Authorization` header. **Prefer the signature** — it is this repo's own affiliate-webhook standard; verify at implementation that it's available on our plan, and fall back to the static header (still `timingSafeEqual`-compared) only if not.
- **Our database mirrors, never originates,** entitlement state: the RevenueCat webhook writes `PremiumEntitlement`; the reconciliation job (Decision 4a — worker-runtime scheduler, not a serverless `@Cron`) plus a per-user refresh endpoint (RevenueCat REST `GET /subscribers/{app_user_id}`) correct drift and beat webhook latency after purchase.
- **Known degraded mode, named plainly — "paid-but-locked":** a RevenueCat outage delays _new activations_ (web activations block on the forward → RC round trip; mobile activations on RC's own ingestion), while already-synced entitlements keep working from our mirror. The forward outbox holds the obligation durably; the reconciliation job re-drives it on recovery; the web UI shows a bounded pending state (Decision 12) rather than a false failure; and the runbook's break-glass is an RC promotional grant (the `promotional` store member exists exactly for this). A Stripe-sourced provisional activation was considered and rejected — it would create a second entitlement writer, and dual-writer drift is a worse failure than bounded delay. Also accepted and surfaced in copy: RevenueCat documents that Stripe-sourced **cancellations can take up to ~2 hours** to reflect; the Portal-return UX sets that expectation (Decision 12) instead of promising instant state.
- **Privacy note for the ADR:** `app_user_id` = raw `User.id` diverges from the repo's pseudonymization discipline (PostHog only ever sees HMAC subject ids). It is defensible — the webhook must map back to a user — but the ADR must weigh a dedicated `rc_app_user_id` alias as the alternative; either outcome is acceptable, undiscussed is not.

**Why not first-party store APIs** (Apple App Store Server API + Server Notifications V2, Google Play Developer API + Real-time Developer Notifications): RTDN requires a Google Cloud Pub/Sub push subscription — an entirely new cloud vendor and IAM surface for this repo — plus three separate verification stacks (Apple JWS x5c chain, Google service-account JWT, Stripe HMAC) and two more webhook endpoints. RevenueCat collapses the verification burden and is free to $2,500 monthly tracked revenue — and note the fine print: **forwarded Stripe revenue counts toward MTR** (the ~1% at scale applies to web revenue too), and the free tier's webhook/integration availability must be confirmed during provisioning.

**Why not RevenueCat Web Billing** (RC's own hosted web checkout, evaluated and rejected): the epic names Stripe checkout; Web Billing moves the checkout surface and the customer/billing relationship onto RevenueCat, deepening lock-in exactly where this design preserves reversibility (the web rail is the reversible half); and our own Stripe account keeps Checkout/Portal capabilities RC's hosted flow doesn't match. Recorded here so the ADR inherits the rejection with its reasons.

**Reversal path, honestly stated:** the **web half is bounded** — subscriptions live in our Stripe account; reversing RC there means pointing entitlement writes at Stripe webhooks we already receive. The **mobile half is not cheap**: the RC SDK in shipped binaries is the offerings source, purchase UI, and restore flow, so reversal means a replacement IAP client, app-store review cycles, keeping RC alive for old installs, and migrating RC-side receipts/config — a multi-release migration, not a swap. The server contract (`PremiumEntitlement`, status/refresh, the guard, both settings sections) survives unchanged in either direction; that is the part this story keeps vendor-neutral by construction.

**Sign-off:** this is a vendor selection the architecture document reserved ("Payments/commerce **reserved for future integration (Stripe)** with placeholders in the commerce module", `architecture.md:126` — Stripe is honored for web). It needs an ADR entry, and the ADR must weigh **both** architecture principles: the free-tier-friendly launch posture (`architecture.md:12`) that favors RC, and the document's otherwise-minimalist vendor philosophy (one payments vendor was reserved, not two) that counts against it. Accepted 2026-08-12 (Open question 1, resolved); the ADR entry (Task 10) records the weighing.

### Decision 2 — What "gate Premium-only surfaces" means in this codebase today

Recon fact: **none of the three named surfaces exists yet.** The web `PlannerRail` (`apps/web/src/app/components/planner-rail.tsx`) is a static shell from Story 3.5 with no data and no API; there is no palette-analysis HTTP endpoint (`PaletteInsights` is DB-only); themes are CC-5.3. All three later stories (CC-5.3/5.4/5.5) list CC-5.2 as their prerequisite precisely because this story ships the _check_, not the surfaces.

So AC 4 scopes to: (a) the server guard + entitlement service, supertest-proven; (b) client entitlement helpers on both surfaces; (c) one real, user-visible demonstration — the `PlannerRail` shell becomes entitlement-aware (locked upsell state with a "Get Premium" link to `/settings` for non-entitled/signed-out users; the existing shell content for entitled users). Upsell surfaces obey the PRD's "no dark patterns around conversion prompts" guardrail (`prd.md:47`): the locked state is informative, no fake urgency, no nagging modals, and everything premium-locked says plainly that it is. Do **not** invent a planner, a theme gallery, or a palette endpoint here. The three consuming stories are the owners of gating their own surfaces with this story's primitives; state that in their favor, don't do their work.

Tests that pin the current rail and must be updated with it: `apps/web/src/app/components/lookbook-prism-layout.test.tsx:96-108`, `playwright/tests/lookbook-prism.spec.ts:46,49`, `playwright/tests/accessibility-hardening.spec.ts:320-322` (which runs signed out — the locked state is what it will see, and it must pass axe).

### Decision 3 — Data model

Three new Prisma models + two enums, following 5.1's conventions exactly (cuid ids, `@@map("<ModelName>")`, snake_case columns, integer minor units if money ever appears, check constraints in hand-authored SQL, `now() AT TIME ZONE 'UTC'` for every clock comparison — see Decision 8).

```prisma
enum BillingProvider { stripe revenuecat }                    // lowercase = JSON, no mapping layer
enum EntitlementStore { app_store play_store stripe promotional } // mirrors RevenueCat store values; promotional = RC promotional grants (operator break-glass, runbook)
enum PremiumEntitlementStatus { active grace_period expired revoked }

/// RLS: worker-only. Zero client policies, zero grants. Forgeable rows = free Premium.
model PremiumEntitlement {
  id                     String  @id @default(cuid())
  user                   User    @relation(fields: [user_id], references: [id], onDelete: Cascade)
  user_id                String  @unique
  status                 PremiumEntitlementStatus
  store                  EntitlementStore
  product_id             String            // 'premium_monthly' | 'premium_annual' (operator-provisioned)
  will_renew             Boolean
  current_period_end     DateTime          // UTC in timestamp-without-tz, comparisons via AT TIME ZONE 'UTC'
  synced_at              DateTime          // last successful sync from the ledger
  last_event_occurred_at DateTime          // ordering guard — see Decision 8
  last_event_id          String            // provider event id of the last applied event
  created_at             DateTime @default(now())
  updated_at             DateTime @updatedAt
  @@map("PremiumEntitlement")
}

/// RLS: worker-only. Append-only receipt log; the "receipts stored securely" record.
model BillingEvent {
  id                 String          @id @default(cuid())
  provider           BillingProvider
  external_event_id  String          // RevenueCat event.id / Stripe event.id
  event_type         String          // provider's own type string, e.g. 'INITIAL_PURCHASE', 'customer.subscription.updated'
  user               User?           @relation(fields: [user_id], references: [id], onDelete: SetNull)
  user_id            String?
  store              EntitlementStore?
  product_id         String?
  payload            Json            // ALLOWLISTED fields only — see Decision 6
  occurred_at        DateTime
  received_at        DateTime        @default(now())
  // Forward obligation (Stripe checkout events only — see Decision 4's forward-outbox rule).
  // NULL forward_due = nothing to forward. A due-but-unforwarded row is re-driven by the
  // reconciliation sweep until forwarded_at is set; forward failure must never lose a payment.
  forward_due        Boolean         @default(false)
  forwarded_at       DateTime?
  forward_attempts   Int             @default(0)
  forward_last_error String?
  @@unique([provider, external_event_id])
  @@index([received_at])              // pruner
  @@index([forward_due, forwarded_at]) // reconciliation re-drive scan
  @@map("BillingEvent")
}

/// RLS: worker-only. Stripe customer mapping so Checkout/Portal sessions reuse one customer.
model BillingCustomer {
  id                  String   @id @default(cuid())
  user                User     @relation(fields: [user_id], references: [id], onDelete: Cascade)
  user_id             String   @unique
  stripe_customer_id  String   @unique
  created_at          DateTime @default(now())
  updated_at          DateTime @updatedAt
  @@map("BillingCustomer")
}
```

`User` gains three back-relations (`premium_entitlement PremiumEntitlement?`, `billing_events BillingEvent[]`, `billing_customer BillingCustomer?`).

- Absent `PremiumEntitlement` row = never subscribed; the status endpoint serializes that as `status: 'none'` (a wire-only value — do not add `none` to the Prisma enum; an absent row and a `none` row would be two spellings of one fact).
- **Why worker-only RLS and not `selfOnlyTables`:** 5.1 put `CommercePreference`/`AffiliateClick` in `selfOnlyTables`, which grants authenticated users insert/update on their own rows via Supabase. For a preference that's correct; for an entitlement it is privilege escalation. RLS enabled, zero policies, `REVOKE ALL ... FROM authenticated, anon` (migration template `20260811090000_add_commerce_affiliate/migration.sql:284-297`). **Spec registration — use the right block:** extend the 5.1 commerce worker-only test at `rls-policies.spec.ts:2684-2753`, which asserts both permission state _and_ observable behavior (the 42501-rejection check, `5.1-DB-007` pattern, per PR #125's falsifiability standard). The `privateTables` const at `:738` belongs to the alert-tables test — do not edit it — and worker-only tables are deliberately absent from `targetTables` (`:651-657`).
- **Append-only, enforced not asserted:** `BillingEvent` gets an UPDATE-blocking trigger in the migration, mirroring `20260420160000_harden_audit_log_immutability`. DELETE stays open — the retention pruner needs it. The schema spec asserts the trigger rejects an UPDATE (behavioral, not convention).
- Migration: next timestamp dir under `packages/db/prisma/migrations/`, hand-authored SQL, then `npm run db:generate` (the Prisma client is checked-in-generated; skipping this is a wall of type errors). Check constraints: `product_id` in the two known values on `PremiumEntitlement` — **no**; keep product ids unconstrained (operator adds products without a migration), but constrain `external_event_id` non-empty and `payload` NOT NULL.

### Decision 4 — API surface (all inherit `CommerceCacheHeadersMiddleware`'s `private, no-store` automatically via the `/api/v1/commerce{/*path}` binding)

| Method | Path                                                | Auth                                | Flag-gated                | Success                                                                                                                                                                                                                                                                                                                                                            |
| ------ | --------------------------------------------------- | ----------------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| GET    | `/api/v1/commerce/subscription`                     | `RequestAuthGuard`                  | no (but carries the flag) | `200 { data: { status, store, productId, willRenew, currentPeriodEnd, syncedAt, purchasesEnabled } }` (`status: 'none'` → the entitlement fields `null`; keys always serialized, `.nullable()` never `.nullable().optional()`; `purchasesEnabled` is the server-evaluated `commerce_subscription_enabled` flag — the only flag-exposure path to clients, per AC 5) |
| POST   | `/api/v1/commerce/subscription/refresh`             | `RequestAuthGuard`                  | no                        | `200` same body, after a synchronous RevenueCat REST pull (semantics below)                                                                                                                                                                                                                                                                                        |
| POST   | `/api/v1/commerce/subscription/checkout-session`    | `RequestAuthGuard`                  | **yes**                   | body `{ plan: 'premium_monthly' \| 'premium_annual' }` (`.strict()` Zod enum; invalid → `400` from the schema). `201 { data: { url } }` (Stripe-hosted Checkout URL)                                                                                                                                                                                               |
| POST   | `/api/v1/commerce/subscription/portal-session`      | `RequestAuthGuard`                  | no                        | `201 { data: { url } }` (Customer Portal URL)                                                                                                                                                                                                                                                                                                                      |
| POST   | `/api/v1/commerce/subscription/webhooks/stripe`     | none — signature is the auth        | no (always records)       | `200 { data: { received: true } }`                                                                                                                                                                                                                                                                                                                                 |
| POST   | `/api/v1/commerce/subscription/webhooks/revenuecat` | none — signature/secret is the auth | no (always records)       | `200 { data: { received: true } }`                                                                                                                                                                                                                                                                                                                                 |

- **Status precedence, checkout-session:** `503` flag off → `400` schema → `409` already `active`/`grace_period` (`SUBSCRIPTION_ALREADY_ACTIVE_MESSAGE`) → `500` Stripe API failure (couture-toast on client; same 500-is-honest stance as 5.1 Decision 7).
- **Session→user linkage (nothing left to convention):** checkout sessions are created with `client_reference_id: userId` **and** `metadata: { userId }`; the Stripe customer is created-or-reused **at session-creation time** and `BillingCustomer` upserted then — not at webhook time — so an abandoned checkout still leaves a portal-capable customer and the webhook resolves the user by `client_reference_id` first, `BillingCustomer` lookup by customer id second.
- **Portal-session errors, complete set:** `404` + `SUBSCRIPTION_NOT_FOUND_MESSAGE` when no `BillingCustomer` row exists; `409` + `SUBSCRIPTION_NOT_WEB_MANAGED_MESSAGE` when the entitlement's `store` ≠ `stripe` (the client normally shows a "manage in the App Store / Play Store" hint instead of calling — the server still answers correctly when called); `500` on Stripe API failure or missing key (prod misconfiguration is a 500, not a silent skip).
- **Refresh semantics (the ledger-pull writer, defined):** a REST pull is a _sync_, not an event — it writes **no** `BillingEvent`; it applies the ledger snapshot unconditionally (the ledger is authoritative "as of now"), stamps `synced_at`, sets `last_event_occurred_at` to the pull's server-clock timestamp and `last_event_id` to `pull:<cuid>`, and writes an `AuditLog` row only when state actually changed. Later-arriving webhook events older than the pull timestamp are correctly dropped by the Decision 8 guard — the pull already reflected them. Operationally: per-user in-flight dedupe plus a 10-second minimum interval (inside the window, serve local state — it carries `syncedAt` so the client can tell), 15-second RC timeout, RC failure → `503` + `SUBSCRIPTION_LEDGER_UNAVAILABLE_MESSAGE`. Known RC quirk, accepted: the subscriber GET creates an empty subscriber as a side effect; only authenticated users can trigger it, and empty subscribers are inert.
- **Webhooks** follow 5.1's uniform-rejection invariant: every auth failure is the same `401` + `BILLING_WEBHOOK_UNAUTHORIZED_MESSAGE`, reason logged only, payload parsed **only after** authentication (`affiliate-webhook.service.ts:103-149` is the template). `@HttpCode(HttpStatus.OK)` so replays are indistinguishable from first deliveries. Idempotency: pre-read on `(provider, external_event_id)` then treat `P2002` as replay (`affiliate-webhook.service.ts:202-249`). Both routes are added to the `ApiExceptionFilter` `api_error_occurred` exclusion list by exact path, next to `AFFILIATE_WEBHOOK_ROUTE` — same amplification-vector reasoning.
- **Stripe signature:** `stripe.webhooks.constructEvent(request.rawBody, sig, STRIPE_WEBHOOK_SECRET)`. `rawBody: true` is already set on all three bootstrap classes (5.1 B1 fixed `main.ts:65`, `api/index.ts:20`; new `TestingModule`s must pass `{ rawBody: true }` themselves). Handle: `checkout.session.completed` (upsert `BillingCustomer`, record the event with `forward_due: true`, then forward the subscription to RevenueCat), `customer.subscription.updated`/`.deleted` and `invoice.payment_failed` (record as `BillingEvent`; entitlement state still flows from the RevenueCat webhook to keep one writer — do not create a second entitlement writer out of the Stripe events).
- **Forward outbox (the one place a payment could otherwise be lost):** the RevenueCat forward is the single bridge between "customer paid Stripe" and "customer gets Premium" — refresh and reconciliation both read _RevenueCat_, so a dropped forward is unrecoverable by any other path. Therefore the forward is an outbox obligation, never a fire-and-forget call: the Stripe webhook persists the `BillingEvent` with `forward_due: true` **before** acking `200`, attempts the forward inline, and stamps `forwarded_at` on success / increments `forward_attempts` + `forward_last_error` on failure (the webhook still returns `200` — Stripe retries are not the retry mechanism here). The reconciliation sweep (Decision 4a, every 15 minutes on the worker runtime) re-drives every `forward_due AND forwarded_at IS NULL` row as its first duty. The forward itself is idempotent on RevenueCat's side (same fetch token twice must not create two subscriptions — assert against the test double, note it for the real integration). Pattern precedent: `CapsuleTelemetryClaim` outbox (`schema.prisma:714-735`, `wardrobe-capsule.outbox.ts`).
- **RevenueCat webhook auth:** prefer the HMAC signature per Decision 1; whichever mechanism, compare with `timingSafeEqual` after a byte-length check (`affiliate-webhook-signature.ts:106-110` hazard note). Secret resolution follows `resolvePartnerWebhookSecret`'s shape with an `allowsTestOnlySecrets()` fallback so suites run without real secrets.
- **The transition table (this IS the spec `5.2-API-010` implements — no cell is the dev agent's to invent).** Every authenticated event: record `BillingEvent`, apply the row below in one transaction, write the `AuditLog` row on state change (Decision 7), emit telemetry fail-open after commit.

| Event                            | Entitlement effect                                                                                                                                                                          |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `INITIAL_PURCHASE`               | → `active`; `will_renew: true`; `store`/`product_id`/`current_period_end` from the event                                                                                                    |
| `RENEWAL`                        | → `active`; `will_renew: true`; extend `current_period_end`                                                                                                                                 |
| `PRODUCT_CHANGE`                 | → `active`; update `product_id` (the upgrade/downgrade record); period from the event                                                                                                       |
| `CANCELLATION`                   | **status stays `active`**, `will_renew: false` — the user keeps what they paid for until period end; `EXPIRATION` performs the downgrade. This is the guess-wrong trap; it is now specified |
| `UNCANCELLATION`                 | → `active`, `will_renew: true`                                                                                                                                                              |
| `BILLING_ISSUE`                  | → `grace_period` (access retained; guard passes)                                                                                                                                            |
| `EXPIRATION`                     | → `expired`, `will_renew: false`                                                                                                                                                            |
| `REFUND_REVERSED`                | → `active` (the refund's revocation is reversed)                                                                                                                                            |
| `SUBSCRIPTION_EXTENDED`          | stays `active`; extend `current_period_end` from the event                                                                                                                                  |
| `SUBSCRIPTION_PAUSED`            | record-only, no transition — access is governed by the already-delivered period end; `EXPIRATION`/`RENEWAL` handle the rest                                                                 |
| `TEMPORARY_ENTITLEMENT_GRANT`    | → `active` with the event's expiry (RC issues these during store outages)                                                                                                                   |
| `NON_RENEWING_PURCHASE`          | record-only — no such product exists in this story                                                                                                                                          |
| `TRANSFER`                       | two-user semantics as defined below                                                                                                                                                         |
| `TEST`                           | `200`, record-only — RC fires it when the operator configures the webhook; a non-200 fails the operator's setup check                                                                       |
| **any other authenticated type** | `200`, record `BillingEvent`, no transition, log at info — the enumeration above is not assumed exhaustive, and an unknown type must never bounce a delivery                                |

- **`TRANSFER` semantics (two users, one webhook):** the event names a losing and a gaining `app_user_id`. In one transaction: the losing user's `PremiumEntitlement` → `revoked` (audit row), the gaining user's row upserted `active` with the event's store/product (audit row). A losing user with no local entitlement row is skipped silently; a gaining `app_user_id` unknown locally records the `BillingEvent` with `user_id: null` and writes no entitlement (the reconciliation sweep picks the user up if they appear later).
- **Unknown-subject events never throw:** a RevenueCat event for a deleted/unknown `app_user_id`, or a Stripe event for an unknown customer, returns `200`, records the `BillingEvent` with `user_id: null`, skips the entitlement write, and does not emit `api_error_occurred` (both routes are excluded by path). Deleted-user history is exactly why `BillingEvent.user_id` is `SetNull`-nullable.

### Decision 4a — Periodic work runs where schedules actually fire: the worker runtime

Verified deploy-target facts: the API ships as one Vercel serverless function (`apps/api/vercel.json`, maxDuration 25s); `ScheduleModule.forRoot()` lives only in the request app; no Vercel `crons` config exists anywhere. **A NestJS `@Cron` in this API has never provably fired in production** — including 5.1's `CommerceRetentionService`. This story's payment recovery (forward-outbox re-drive) cannot sit on a decorator that only runs where nobody deploys it. The repo's real substrate for durable schedules is the one ADR-012 already established: **BullMQ 5 Job Schedulers in the standalone worker runtime** (`weather-refresh-sweep` precedent).

- New queue name `billing-reconciliation` in `apps/api/src/config/queues.ts` (`QueueName` union + `queueConfigs`); two Job Schedulers registered in `src/workers/bootstrap.ts`: `billing-reconciliation-sweep` every **15 minutes** (this cadence bounds paid-but-locked recovery after an RC outage) and `commerce-retention-sweep` monthly. The worker bootstrap is hand-wired without Nest DI — construct the services manually like every sibling there, and keep the queue consumed in exactly one bootstrap (the nondeterministic-split warning at `bootstrap.ts:144-151`).
- Per sweep, bounded work (no unbounded iteration, no RC rate-limit surprises): re-drive up to 100 `forward_due AND forwarded_at IS NULL` rows; drift-correct up to 500 entitlements whose `synced_at` is older than 24 h; each duty individually crash-isolated so one throw cannot kill the other or the worker.
- **5.1 debt paid here, not logged:** `CommerceRetentionService` loses its `@Cron` decorator and its monthly prune (both 5.1 tables + `BillingEvent`) becomes the `commerce-retention-sweep` job — same batch constants, now on a substrate that fires. The remaining `@Cron` consumers (`feature-flags.cron`, `admin.cron`, `guardian.cron`) share the dead-substrate defect but belong to other epics' features; they go to `deferred-work.md` with this evidence and an owner ask, because unverifiable cross-feature changes don't belong in a billing PR.
- Local/CI: the worker runtime already runs via `scripts/start-api-e2e-with-workers.mjs`; integration tests invoke the sweep processors directly (deterministic), plus one worker-bootstrap unit test asserting both schedulers are registered with the right cadences.
- New Nest files live in `apps/api/src/modules/commerce/` as siblings (`subscription.controller.ts`, `subscription.service.ts`, `premium-entitlement.service.ts`, `premium-entitlement.guard.ts`, `stripe-billing.service.ts`, `revenuecat-client.ts`, `billing-webhook.controller.ts`, `billing-webhook.service.ts`, + co-located specs). `CommerceModule` exports `PremiumEntitlementService` and the guard for CC-5.3/5.4/5.5. `PersonalizationModule` imports `CommerceModule`, never the reverse (`commerce.module.ts:26-34`).
- `PremiumEntitlementGuard`: runs after `RequestAuthGuard`, reads `request.auth.userId`, `403` + `PREMIUM_REQUIRED_MESSAGE` when status ∉ {`active`, `grace_period`}. Grace period keeps access (store guidance: don't punish a card hiccup). No route in this story mounts it except the supertest fixture proving it; CC-5.5's planner API will be its first production consumer — the exported service + web rail gate are this story's live consumers, so the guard ships tested but dormant, and that is stated here so a reviewer doesn't flag dead code.

### Decision 5 — Contracts

- New module `packages/api-client/src/contracts/http/subscription.ts` + barrel line in `index.ts` + `registerSubscriptionContracts(registry, commonSchemas)` wired in `openapi.ts:52-71`. Bump `info.version` **1.1.0 → 1.2.0** (additive operations; `schema-validation.yml` runs `optic:diff` and forces the recorded decision).
- Error envelope is `.strict()` `{ statusCode, message, error }` — no codes on the wire. Export message constants from `subscription.ts`: `COMMERCE_SUBSCRIPTION_DISABLED_MESSAGE`, `SUBSCRIPTION_ALREADY_ACTIVE_MESSAGE`, `SUBSCRIPTION_NOT_FOUND_MESSAGE`, `SUBSCRIPTION_NOT_WEB_MANAGED_MESSAGE`, `SUBSCRIPTION_LEDGER_UNAVAILABLE_MESSAGE`, `BILLING_WEBHOOK_UNAUTHORIZED_MESSAGE`, `PREMIUM_REQUIRED_MESSAGE`.
- Prefer structural constraints; any surviving `.refine()` needs `.openapi({ description })` or `contract-invariants-documented.spec.ts` fails.
- Extend the hand-maintained re-export block in `apps/api/src/contracts/http.ts` (it does NOT `export *`). Clients import the deep subpath `@couture/api-client/contracts/http`.
- Regenerate: `npm run generate:api-client` then `npm run optic:lint`; commit the generated diff (`SubscriptionApi.ts` + regenerated siblings) with no hand edits.
- Analytics: add the four event names to `analyticsEventNameSchema` **and** `analyticsEventSchemas` (`analytics-events.spec.ts:49-51` asserts set equality) **and** `analyticsPropertySchemas` in `analytics-event-assertions.ts`, plus `track*` builders and negative fixtures proving the allowlists reject receipt ids, URLs, emails, and prices.

### Decision 6 — Receipts stored securely = allowlisted, append-only, provider-agnostic

`BillingEvent.payload` stores an **allowlisted projection**, never the raw provider body: `{ eventType, store, productId, periodType, purchasedAtMs, expirationAtMs, cancelReason, environment }` (nulls where absent). The mapping is per-provider and unmappable fields are `null` — RevenueCat events fill most fields directly; Stripe events map `eventType` = `event.type`, `store` = `stripe`, `productId` = the price lookup key, `expirationAtMs` = `current_period_end × 1000`, `cancelReason` = `cancellation_details.reason`, `environment` = `livemode`, and `periodType`/`purchasedAtMs` stay `null`. Explicitly banned from persistence and from logs: subscriber attributes, email, name, address, card metadata (Stripe never exposes PANs — nothing card-shaped exists to store), promotional codes, and full webhook bodies. The full-fidelity record lives in the provider dashboards (RevenueCat/Stripe), which is where refund/tax disputes are worked anyway. Unit tests assert the projection strips a maximal fixture per provider. 24-month retention via the `commerce-retention-sweep` job (Decision 4a; same batch and isolation constants; extend `commerce-retention.service.spec.ts`). **Both halves of this decision — receipts-as-projection instead of raw receipts, and the 24-month horizon against 6-10-year financial-records law in some jurisdictions — are a reinterpretation of the epic's "receipts stored securely" and carry legal exposure; they are Open question 4, signed off as-is 2026-08-12 with the rationale recorded there.**

### Decision 7 — Audit + telemetry

- Every entitlement transition writes `AuditLog` `{ user_id, event_type: 'premium_entitlement_changed', event_data: { from, to, store, productId, provider }, ip_address: null }` inside the same transaction as the `PremiumEntitlement` write, following `commerce.repository.ts:126-162` (read-inside-transaction, no-op transitions write nothing).
- Server events go through `TelemetryService.captureEvent` with `buildAnalyticsSubjectId` (exported since 5.1); add the three server events to `PSEUDONYMOUS_EVENT_TYPES` (`telemetry.service.ts:450`) and the builder table (declared at `:457`). Emit after commit, fail-open — a degraded PostHog must never fail a billing webhook (5.1 Decision 12 verbatim).
- `premium_subscribe_tapped` is client-side only (mobile + web), client's own `distinctId`, like `trackMobileRitualCreated` — it never touches `TelemetryService` or the `telemetry_events` table.
- **Relationship to the 5.1 commerce opt-out, stated:** `CommercePreference.affiliate_ctas_enabled` governs affiliate CTAs and their tracking; the four premium events are billing-operations telemetry for a service the user is actively purchasing, and are **exempt** from that toggle (a user who opted out of affiliate prompts and then subscribes still produces billing telemetry — pseudonymous, allowlisted). The settings disclosure covers this (AC 7); PRD `:45`/`:257` opt-out obligations attach to personalization/commerce _tracking_, not to processing a purchase the user initiated.
- **Processor-side erasure:** account deletion must un-share what AC 7 discloses — delete the RevenueCat subscriber (REST `DELETE /subscribers/{app_user_id}`) and the Stripe customer when `BillingCustomer` exists. Recon found no account-deletion flow in this codebase yet, so this ships as `PremiumEntitlementService.eraseProcessorData(userId)` — built, tested against the fakes, and exported — with wiring into the (future) deletion flow assigned an owner via Open question 5. Building the hook now means the deletion story cannot forget billing.

### Decision 8 — Clocks, money, idempotency (inherited hard rules)

- Every SQL clock comparison on the new tables is `now() AT TIME ZONE 'UTC'` — 5.1 shipped a five-hour window shift by comparing `timestamptz now()` against UTC-in-naive-timestamp columns; billing periods hit this immediately.
- No floating-point money anywhere. This story renders **no prices from our API** (Stripe Checkout and the stores render prices); if a price ever crosses our wire later, it is integer minor units + ISO-4217 code.
- Webhook handlers are idempotent by `(provider, external_event_id)`; replays are dropped at that unique index before any transition logic runs.
- Entitlement ordering guard, exact rule (equal timestamps are a real case — RevenueCat emits `RENEWAL` + `PRODUCT_CHANGE` pairs with identical `occurred_at` at period boundaries): apply the event iff `occurred_at > last_event_occurred_at`, **or** `occurred_at == last_event_occurred_at AND external_event_id != last_event_id` (distinct same-instant events apply in arrival order, which the idempotency index makes deterministic per event). Strictly-older events are dropped. Assert all three cases — older, equal-distinct, newer — in the integration suite, DB clock.

### Decision 9 — Making the feature reachable (5.1 Decision 14 analog)

Without provisioning, every path is unreachable in every environment. Behind `allowsCommerceSeeding()` / `allowsTestOnlySecrets()`:

- Seed (`packages/db/prisma/seeds/commerce.ts`, extend): three entitlement fixtures spanning the state space the E2E suites need — `active`/`stripe`/`premium_monthly` (with `BillingCustomer` + a `BillingEvent` pair), `expired`/`stripe`, and `grace_period`/`app_store` (exercises the store-managed manage-hint branch and the grace banner). `revoked` is constructed per-test via the factory, not seeded. Update `commerce-seed.spec.ts` and the `packages/db` coverage ratchet expectations.
- Test-only secrets: `buildTestOnly…` fallbacks for `STRIPE_WEBHOOK_SECRET`, `REVENUECAT_WEBHOOK_AUTH`, and a **fake Stripe client** (`resolveStripeClient()` returns a deterministic double when `allowsTestOnlySecrets()` and no real key is set) so integration + Playwright suites never call Stripe. The double returns stable URLs (`https://checkout.stripe.test/…`) and canned session objects; hosts stay RFC-2606 `.test`. **Scope of the fake — outbound API calls only** (`checkout.sessions.create`, `billingPortal.sessions.create`, customer ops). Webhook signature verification always runs the **real** `stripe` library: `constructEvent` is pure local HMAC, and it is the webhook's only authentication, so faking it would ship the auth branch untested. Suites sign their fixtures with the test-only `STRIPE_WEBHOOK_SECRET` via `stripe.webhooks.generateTestHeaderString`.
- Flag seeded on in test/local (`commerce_subscription_enabled: allowsCommerceSeeding()` in `canonicalFlagOverrides` — the `Record<FeatureFlagKey, …>` type makes omission a compile error).
- **Operator runbook** (extend `_bmad-output/project-knowledge/secrets-management.md`; the human-only subset is captured now in `_bmad-output/project-knowledge/premium-release-checklist.md`, which Task 10 must keep consistent), in dependency order:
  1. **App identity first — everything else is blocked on it:** `bundleIdentifier`/`package` are still `com.anonymous.mobile` (`apps/mobile/app.json:19,31`). Real identifiers must be chosen and set before any store provisioning; an iOS bundle id cannot be changed after the App Store app exists. Product picked the ids 2026-08-12: `com.couturecast.app` for both iOS `bundleIdentifier` and Android `package`; Task 6 sets them. Changeable at zero cost until the App Store app record is created, so revisit then if a domain-matched id is preferred.
  2. App Store Connect: app + subscription group + `premium_monthly`/`premium_annual`; Play Console: app + base plans.
  3. Stripe: Products/Prices (+ per-locale currency presentation for the three PRD locales — Checkout and Portal render prices, so PRD NFR Localization 2 (`prd.md:273`) is satisfied by Stripe configuration, and the runbook says how), Portal configuration (cancel + plan-switch enabled — this is also FR5.2's "downgrade path documented"), webhook endpoint + secret.
  4. RevenueCat: project, `premium` entitlement, store apps, Stripe integration, webhook (signature auth preferred per Decision 1) + secret; confirm webhook/integration availability on the free tier.
  5. Env vars per environment (Decision 10).
  6. **Staged smoke gate (release blocker):** before the flag turns on anywhere real, one full web chain run in Stripe test mode + RC sandbox (checkout → Stripe webhook → forward → RC webhook → entitlement visible), and one sandbox store purchase on a dev build. Nothing in CI executes the real chain (every provider is faked there), so this staged run is the only pre-production proof and is recorded as such.
     Name the accountable owner in the PR description (5.1 C-8 rule).

### Decision 10 — Secrets and env

`.env.example` additions, following the ≥32-byte and commented-placeholder conventions (`:15-41` — read the warning there; a set-but-placeholder secret makes the server verify with one secret while suites sign with the test fallback, and every valid webhook 401s):

```
STRIPE_SECRET_KEY=            # server only; test mode in non-prod
STRIPE_WEBHOOK_SECRET=        # from the Stripe endpoint config
STRIPE_PREMIUM_MONTHLY_PRICE_ID= / STRIPE_PREMIUM_ANNUAL_PRICE_ID=
REVENUECAT_SECRET_API_KEY=    # REST reads + Stripe receipt forwarding
REVENUECAT_WEBHOOK_AUTH=      # static Authorization header value, ≥32 bytes
EXPO_PUBLIC_REVENUECAT_APPLE_API_KEY= / EXPO_PUBLIC_REVENUECAT_GOOGLE_API_KEY=   # public SDK keys
```

No Joi/Zod env schema exists (`load-env.ts` only loads files); validate at point of use like `resolvePartnerWebhookSecret` — throw at first use with an actionable message, test-only fallback under `allowsTestOnlySecrets()`. Gitleaks stays green: values never in fixtures, logs, or commits. Note `apps/web` runtime deps are policed by `check:web:aliased-runtime-deps` — the web app gains **no** Stripe dependency (Checkout is a redirect; the session comes from our API).

### Decision 11 — Mobile integration shape

- Add `react-native-purchases` **and `expo-dev-client`** to `apps/mobile`, and add a `development` profile to `eas.json` (today it has only `production` — the dev-build toolchain this SDK needs does not exist yet and is created by this story, after the runbook's app-identity step). Expo Go renders the fallback state. Configure lazily — `Purchases.configure({ apiKey, appUserID })` on first entry to the settings Premium section, with the user id from the existing `user.ts` lib; never at app launch (don't tax the ritual path).
- **Per-status rendering (one rule per status, no guessing):** `none` → subscribe CTA (only when `purchasesEnabled`); `active` → plan name + renewal/period-end line + manage entry; `grace_period` → active UI plus a payment-issue banner pointing at the store/portal payment method; `expired`/`revoked` → subscribe CTA with a "your subscription ended" note. Manage entry: `store === 'stripe'` → "manage on the web" hint (portal is web's); `app_store`/`play_store` → the SDK's native manage-subscription flow (`Purchases.showManageSubscriptions()`). Poll interval: **5 seconds** (24 polls max inside the 2-minute cap).
- New `apps/mobile/src/lib/premium.ts`: `getSubscriptionFromMobile(signal)`, `refreshSubscriptionFromMobile()`, purchase/restore wrappers around the SDK, and a single exported render-state resolver (the `resolveRenderableShopThisLook` pattern — one place answers "what does the section show").
- **Purchase outcome state machine — enumerate all five, this is a 13+ product:** `success`, `user-cancelled` (quiet return to idle, no error banner), `sdk-unavailable` (Expo Go / native module absent → informational fallback state), **`deferred`** (StoreKit "Ask to Buy": a teen's purchase awaits guardian approval — the SDK returns neither success nor cancel, and the entitlement arrives hours later via webhook; show a dedicated pending-approval state with its own i18n key and do **not** start the post-purchase poll), and `error` (localized message, `accessibilityRole="alert"`). One unit test per state, fake timers where timing matters.
- Settings section: sibling `View` after the commerce section (`settings.tsx:327-378` is the exact markup/state/a11y pattern — `testID`s, `accessibilityRole`, optimistic-free here: purchases are not optimistic, show busy state with `accessibilityState={{ busy: true }}`). Post-purchase (success outcome only): call `refresh`, then poll status — bounded: fixed interval, hard stop at 2 minutes, terminal "still processing, check back shortly" state rather than spinning (the AC's clock, made visible). Poll behavior is unit-tested with fake timers; no wall-clock sleeps anywhere in the suites.
- After entitlement changes, nothing premium enters `saveRitualCache` in this story (no premium ritual payload exists); when CC-5.3+ add premium payloads they inherit Decision 6-of-5.1's stripping rule — noted so it isn't lost.
- Tests live under `apps/mobile/src/screens/` (never `app/**` — not in vitest include); mock `react-native-purchases` in `src/test-utils/mocks` (native module absent under vitest); extend `mockRitualResponse`-style MSW handlers for the new endpoints; extend the all-locales overflow assertion in `tab-two-screen.test.tsx:248-282`.
- Maestro, honestly scoped: the harness pins Expo Go (`MOBILE_E2E_EXPO_GO_VERSION`), where the RC native module is absent — so `maestro/premium-subscription.yaml` verifies the settings section **against the fresh signed-up user the harness bakes into the bundle, plus the SDK-absent fallback branch, and that is all it can verify**. _Corrected 2026-08-13 during integration: this decision originally said "the seeded entitled user", which the harness cannot reach — `run-maestro.mjs` signs up a fresh account and bakes its token in via `EXPO_PUBLIC_E2E_ACCESS_TOKEN`, with no token-override path, and editing that shared script was out of this story's scope. Entitled-state rendering is covered instead by the mobile screen tests (MSW) and by the Playwright seeded-user specs. A harness change to reach seeded users is deferred work, not a gap in this flow._ The purchase UI on a dev build is exercised in the runbook's staged smoke, not by Maestro; the flow file says so in a header comment. Per-flow scripts `test:mobile:e2e:premium:{android,ios}` (`run-maestro.mjs:56` defaults would otherwise never run it).

### Decision 12 — Web integration shape

- `apps/web/src/lib/premium.ts` mirrors `commerce.ts` exactly: `createWebApiClient` + `sessionStorage` bearer (`WEB_ACCESS_TOKEN_STORAGE_KEY`), `hasWebSession()` guard, `.strict()`-envelope `readServerMessage`, Zod-parsed responses, `PREMIUM_SIGNED_OUT_MESSAGE`.
- `SubscriptionSection` becomes the second child section on `/settings` (after `CommercePreferencesSection`): status line, subscribe button (→ checkout-session → `window.location.assign(url)`), manage button (→ portal-session, only when `store === 'stripe'`; otherwise a "manage in the App Store / Play Store" hint), disclosure paragraph, signed-out disabled state with hint — the axe suite loads `/settings` unauthenticated at both viewports and must stay green, and the four load-bearing page attributes (`main#main-content`, `tabIndex={-1}`, `data-focus-surface="dark"`, `StickyBottomNav`) must survive.
- `PlannerRail` gate per Decision 2: accept entitlement state from the layout (fetched via `premium.ts`; signed-out/unknown → locked), locked state keeps `aria-label="Planner Rail"` and passes axe.
- Return/cancel URLs for Checkout/Portal: `/settings?checkout=success|cancelled` and `/settings?portal=return` — the section reads the param; no new route. **No new BFF route handlers** — the only `route.ts` in the app stays `/api/health`; sessions come from the Nest API like every other data path.
- **Web pending state (the post-purchase race is real on web too):** on `checkout=success`, do not fire one refresh and hope — run the same bounded poll as mobile (5-second interval, 2-minute cap, terminal "still processing, check back shortly" state), showing a `role="status"` "payment received, activating…" line while polling. A single refresh can legitimately return `none` before the forward → RC round trip completes, and a success banner over `status: none` is exactly the contradiction to avoid.
- **Portal-return expectations:** on `portal=return`, fire one refresh and show copy that store-side changes (especially cancellations) _can take a while to appear_ — RevenueCat documents up to ~2 hours for Stripe-sourced cancellation sync (Decision 1). No poll here; the state is not wrong, it is lagging, and the copy says so.

### Decision 12a — Locale keys, enumerated (ten catalogs × both surfaces; drafts pending human review per AC 7)

`commerce.premium.*`: `sectionTitle`, `disclosure`, `status.none`, `status.active`, `status.gracePeriod`, `status.expired`, `status.revoked`, `planMonthly`, `planAnnual`, `subscribe`, `manage`, `manageInStore`, `restore`, `pendingApproval`, `activating`, `stillProcessing`, `portalLagHint`, `graceBanner`, `endedNote`, `errorLoad`, `errorPurchase`. Web-only: `signedOutHint`, `plannerLocked.title`, `plannerLocked.cta`. Mobile-only: `unavailableInBuild`. The asymmetry is deliberate and stated, like 5.1's 13-vs-12 key split. "Premium" is a cognate in most of the ten locales — budget the `APPROVED_COGNATES` entries in both new parity specs up front.

### Decision 13 — Feature flag

`commerce_subscription_enabled` in `packages/config/src/flags.ts` (boolean, `defaultValue: false`, comment mirroring 5.1's "degraded PostHog can never switch commerce ON by accident"). Touch all four registry files: `flags.ts`, `flags.spec.ts` (exact-key array + boolean-default assertions), `seeds/feature-flags.ts` (`canonicalFlagOverrides`), and `feature-flags.service.spec.ts` — its per-key expectations live at `:119-125` and `:151-157`, **and both `synced: 5` literals (`:118`, `:150`) become `6`** (an easy-to-miss forced edit). Gate check via `FeatureFlagsService.getFeatureFlag('commerce_subscription_enabled', userId)` with the literal-`true` narrowing note (`affiliate-offer.service.ts:216-219`); client exposure only via `purchasesEnabled` on the status response (AC 5). `premium_themes_enabled` is CC-5.3's — do not touch it.

## Prerequisites

Epic list (`epics.md:436`): CC-5.1 (**done**, merged `6882aae`), CC-1.4 (**done**). Real set beyond the epic's, each verified `done` in `sprint-status.yaml`: CC-0.2 (Prisma/migrations), CC-0.3 (Supabase), CC-0.6 (CI), CC-0.9 (OpenAPI/SDK pipeline), CC-0.10/0.14 (factories, Pact/k6 harnesses), CC-0.11 (RLS helpers `private.can_manage_self_row`), CC-3.2 (i18n + ten locales), CC-3.6 (settings/nav surfaces), CC-3.8 (a11y gates). Operational prerequisite: the runbook owner of Decision 9 — store/Stripe/RevenueCat provisioning is operator work this story documents but cannot execute.

## Tasks / Subtasks

- [x] **Task 1 — Schema, RLS, seeds, factories (AC 3, 8)**
  - [x] Prisma models/enums per Decision 3; hand-authored migration with worker-only RLS blocks (template `20260811090000…/migration.sql:284-297`) + the `BillingEvent` UPDATE-blocking trigger; `User` back-relations; then `npm run db:generate`
  - [x] Register all three tables in the **5.1 commerce worker-only block at `rls-policies.spec.ts:2684-2753`** (incl. the 42501 behavioral rejection test — not the alert-tables `privateTables` const at `:738`) + `SeededScenario`/`seedScenario()`/`cleanupScenario()`; run the full actor matrix locally against Docker PG and in CI (`pr-checks.yml` has the DB + Supabase-compatible roles since 5.1)
  - [x] `packages/testing`: `premium.factory.ts` (entitlement/billing-event/billing-customer builders + persist + `registerCreatedEntity`), registry keys, `cleanup.ts` delegates + delete order (billing events → entitlements → customers → users; reuse `cleanupScopeStartedAt` for any unowned rows), factory specs
  - [x] Seeds per Decision 9 + `commerce-seed.spec.ts` extension; `packages/db` coverage ratchet (`vitest.config.ts:31`) stays green
  - [x] `packages/db/test/premium-schema.spec.ts`: constraints, uniqueness, SetNull survival of `BillingEvent` on user delete, append-only expectations
- [x] **Task 2 — Contracts + analytics registries (AC 4, 6)**
  - [x] `subscription.ts` Zod module, message constants, barrel, `registerSubscriptionContracts`, `openapi.ts` 1.2.0, `apps/api/src/contracts/http.ts` block
  - [x] Analytics: three registries + builders + negative fixtures (Decision 5); `packages/api-client/testing/subscription-contract.spec.ts` + `premium-analytics.spec.ts` following the commerce siblings
  - [x] `npm run generate:api-client`, `npm run optic:lint`, commit generated diff
- [x] **Task 3 — Entitlement core (AC 4)**
  - [x] `PremiumEntitlementService` (status read, upsert-from-ledger with the Decision 8 ordering guard), `PremiumEntitlementGuard`, status + refresh endpoints, `CommerceModule` exports
  - [x] Supertest over a Nest `TestingModule` whose app is created with `createNestApplication({ rawBody: true })` (the option goes on app creation, not the module — precedent `commerce-affiliate-webhook.integration.spec.ts:252`): guard 401/403/200 paths over HTTP (HTTP-visible behavior gets HTTP assertions — Story 4.4 lesson). The guard's fixture controller is registered in the `TestingModule` only, never in `CommerceModule` — assert the production route table gains no fixture route
  - [x] Cross-user authz over HTTP: user A's token can never read user B's subscription; the endpoint takes no id parameter and the contract test asserts none exists (the RLS matrix covers Supabase clients, not this API — this closes that gap)
- [x] **Task 4 — Stripe rail (AC 2, 3, 5)**
  - [x] `stripe` dep in `apps/api` only; `resolveStripeClient()` test double scoped to outbound calls per Decision 9; checkout-session (flag gate + 409 precedence) and portal-session endpoints; `BillingCustomer` upsert
  - [x] Stripe webhook: **real** `constructEvent` on `request.rawBody` (never the double), event allowlist, `BillingEvent` recording with `forward_due`, inline forward attempt + outbox stamping per Decision 4, exception-filter exclusion, uniform 401
  - [x] Signature suite over HTTP, fixtures signed via `generateTestHeaderString`: valid → 200; tampered body → 401; stale timestamp → 401; wrong secret → 401
  - [x] Forward-outbox tests: forward fails → webhook still 200s, row shows `forward_due`, no `forwarded_at`; unknown Stripe customer → 200, `user_id: null`, no entitlement write, no `api_error_occurred`
- [x] **Task 5 — RevenueCat rail (AC 1, 3)**
  - [x] Webhook (Authorization compare via `timingSafeEqual` + length check), event → transition map (Decision 4) including `TRANSFER` two-user semantics, transaction with `AuditLog` + telemetry after commit
  - [x] Ordering tests: replay dropped at the unique index; older event dropped; equal-`occurred_at` distinct event applied; newer applied (all four, DB clock). Transition coverage is the table-driven spec in the Test plan, not anecdotal per-event tests
  - [x] Unknown `app_user_id` → 200, `BillingEvent` with `user_id: null`, no entitlement write, no `api_error_occurred`
  - [x] `revenuecat-client.ts` REST wrapper (subscriber GET, `POST /v1/receipts` forward, subscriber DELETE for erasure) with test-only fallback; refresh endpoint per Decision 4's ledger-pull semantics; `eraseProcessorData(userId)` per Decision 7
  - [x] Decision 4a substrate: `billing-reconciliation` queue, both Job Schedulers in `workers/bootstrap.ts` (registration unit test), sweep processor — duty 1: re-drive `forward_due` rows (test: re-forward → entitlement activates); duty 2: drift correction (local `active`, ledger `expired` → downgrade + audit row); each duty crash-isolated; `CommerceRetentionService` re-hosted onto `commerce-retention-sweep` (drop `@Cron`, keep constants, extend its spec, add `BillingEvent` pruning)
  - [x] Integration specs in `apps/api/integration/` (partition fixtures per file — user-scoped rows make garment-category-style partitioning unnecessary, but keep event-id namespaces file-private to survive parallel Vitest)
- [x] **Task 6 — Mobile (AC 1, 6, 7)** — per Decision 11: `react-native-purchases` + `expo-dev-client` deps, `eas.json` `development` profile, app identity set per runbook step 1, `premium.ts`, settings section with per-status rendering, purchase state machine (all five outcomes), post-purchase poll, Decision 12a i18n keys + mobile `premium-locales.spec.ts`, screen tests with SDK mock, MSW handlers, overflow assertion (`tab-two-screen.test.tsx:378`, locale loop `:394`)
- [x] **Task 7 — Web (AC 2, 4, 6, 7)** — per Decision 12: `premium.ts`, `SubscriptionSection` with per-status rendering + post-checkout bounded poll + portal-return copy, planner-rail gate + updated pinned tests, Decision 12a i18n keys + web `premium-locales.spec.ts`, MSW handlers, `settings/page.test.tsx`
- [x] **Task 8 — Pact (AC 1, 2, 4)**
  - [x] Interactions in `api-contract-interactions.ts`, scoped to what each consumer actually calls (Pact mirrors usage): **mobile** — status + refresh only; **web** — status, checkout-session (201/503/409), portal-session (201/404). `state-handlers.ts` + `configureProvider…` branch. Provider states: `'The user has an active premium entitlement'`, `'The user has no premium entitlement'`, `'Premium subscriptions are disabled'`, `'The user has a Stripe billing profile'`; the portal-404 arrangement is "active entitlement via `app_store`, no Stripe profile" — reachable with these states plus factory overrides. One interaction per test; three-run determinism gate
- [x] **Task 9 — E2E + perf (AC 1-5)**
  - [x] Playwright: `premium-subscription.spec.ts` (settings section signed-in/signed-out, locked/unlocked planner rail via seeded users) + `tests/api/premium-subscription.api.spec.ts` (status/refresh/webhook happy + rejection paths via public API); session helper modeled on `commerce-session.ts`
  - [x] Checkout hand-off without leaving the app: `checkout.stripe.test` does not resolve, so the spec intercepts/asserts the session URL (network-first) or stubs the navigation — the browser never actually navigates to a `.test` host
  - [x] k6: `subscriptionStatus` SLO key in **both** branches of `k6/helpers/config.ts` + `scenarioNames` + threshold entry; absolute P95, justified in a doc block like `ritualEligible`'s. **`GET /subscription` only — `refresh` stays out of k6** (it calls the RevenueCat ledger per hit; a load run must not become a ledger hammer)
  - [x] Maestro flow + per-flow scripts (Decision 11); run once on a booted simulator and say exactly how far it verified
- [x] **Task 10 — Gates and evidence (all ACs)**
  - [x] All coverage ratchets green (api 94/88/95/94, web 94/88/93/94, mobile 90/85/90/92, db 13/10/9/14); unit-cover error branches — integration suites still don't run in CI (deferred-work #10 stands; billing webhooks land in the same unprotected tier — say so in the PR)
  - [x] `verify:changed` limitation: `playwright/`, `pact/`, `k6/`, `maestro/`, `scripts/` need explicit runs; full list: `npm run test:pact`, `npm run test --workspace api` (needs PG+Redis), `npm run test:pw-local`, k6 smoke, per-flow Maestro, `npm run validate`
  - [x] Runbook (incl. app identity + staged smoke gate) + `.env.example` + ADR draft for Decision 1 (per its stated conditions) + `deferred-work.md` entries: dead-`@Cron` substrate for the remaining non-commerce crons (`feature-flags.cron`, `admin.cron`, `guardian.cron` — evidence from Decision 4a, owner asked), StoreKit-sandbox automated E2E, socket push for entitlement changes, a Stripe-sourced `will_renew` display shortcut for the ~2 h cancellation lag, PRD "ad-free experience" (`prd.md:79` — moot until ads exist), first-party migration notes; PR names the provisioning owner

## Test plan

Risk-based, per the TEA framework: webhook boundaries default P2×I3 = 6 (high — must be integration-tested); everything money-bearing gets a named test here so coverage is auditable, not anecdotal. Test IDs follow the `5.1-DB-010` convention: `5.2-<AREA>-<nnn>`. **No wall-clock sleeps anywhere in any suite** — fake timers (unit), DB clock (integration), polling helpers with bounded timeouts (E2E).

### The 2-minute sync AC, decomposed (this is how AC 1/2's clock is actually proven)

The 2-minute promise spans provider latency CI cannot test. It decomposes into four falsifiable pieces; together they are the AC's evidence:

| ID          | Level                | Assertion                                                                                                                                                                                                                                                                                                   |
| ----------- | -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 5.2-INT-001 | integration          | Webhook receipt → `GET /subscription` reflects the transition in the **same** request cycle: the entitlement write is synchronous inside the webhook transaction, no queue between receipt and visibility                                                                                                   |
| 5.2-INT-002 | integration          | `POST /refresh` returns updated state on demand from the ledger (fake), covering the client-initiated path when a webhook is late                                                                                                                                                                           |
| 5.2-MOB-001 | unit (fake timers)   | Post-purchase poll: 5-second interval, hard stop at 2 minutes, terminal "still processing" state; never starts for `deferred` outcomes                                                                                                                                                                      |
| 5.2-WEB-001 | unit (fake timers)   | Web post-checkout poll: same bounds as 5.2-MOB-001, "activating…" `role="status"` line while polling; a `none` response mid-poll never renders as failure                                                                                                                                                   |
| —           | monitoring, not test | Provider webhook latency (Stripe/RevenueCat → us, typically seconds) is untested by CI and stated so; it is observable in Grafana via webhook-receipt telemetry timestamps. The controllable guarantee is "visible on demand + bounded client poll", not a server-side sync SLO — the ADR says this plainly |

### Entitlement state machine — table-driven, not anecdotal

One spec, `5.2-API-010`, drives the full transition table **whose cells Decision 4 defines** — the spec implements that table, it does not invent it: current status (`none`/absent, `active`, `grace_period`, `expired`, `revoked`) × every Decision 4 event row (including `TEST`, `SUBSCRIPTION_PAUSED`, and the unknown-type record-only rows) → expected status, `will_renew`, `product_id`, `current_period_end`, audit row, telemetry event. Every cell is a row in the spec; record-only cells assert no transition happened. Grace-period-keeps-access is asserted twice: here, and in the guard suite (`5.2-API-011`: `active` 200, `grace_period` 200, `expired`/`revoked`/absent 403 with `PREMIUM_REQUIRED_MESSAGE`).

### Coverage matrix by AC

| AC  | P0 evidence (blocks merge)                                                                                                                                                                                                                                                                                     | P1 evidence                                                               |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| 1   | 5.2-INT-001/002; RC webhook ordering quartet (replay / older / equal-distinct / newer, `5.2-INT-010..013`); purchase state machine unit tests incl. `deferred` (`5.2-MOB-002..006`)                                                                                                                            | Maestro settings-section render (`5.2-E2E-020`, seeded entitled user)     |
| 2   | Stripe signature quartet over HTTP (`5.2-INT-020..023`: valid/tampered/stale/wrong-secret via `generateTestHeaderString`); forward-outbox trio (`5.2-INT-024`: fail→200+due, `5.2-INT-025`: sweep re-drive→active, `5.2-INT-026`: forward idempotent)                                                          | Playwright checkout hand-off, no real navigation (`5.2-E2E-010`)          |
| 3   | State-machine table (`5.2-API-010`) incl. TRANSFER two-user transaction; `BillingEvent` append-only + `(provider, external_event_id)` unique + SetNull-survives-user-delete (`5.2-DB-010..012`); payload-allowlist strip test vs a maximal fixture (`5.2-API-012`); retention pruner extension (`5.2-API-013`) | Portal-session 201/404 (Pact + supertest)                                 |
| 4   | Guard suite `5.2-API-011` over HTTP; cross-user authz `5.2-API-014`; planner-rail locked/unlocked Playwright (`5.2-E2E-011`, both seeded users) + axe on locked state signed-out                                                                                                                               | Web/mobile lib unit tests parsing `.strict()` envelopes                   |
| 5   | Checkout 503-when-flag-off precedence (`5.2-INT-030`), webhooks-record-when-flag-off (`5.2-INT-031`), status/portal ungated (`5.2-INT-032`)                                                                                                                                                                    | —                                                                         |
| 6   | Three-registry set-equality (existing spec extends automatically); negative fixtures reject receipt ids/URLs/emails/prices (`5.2-CON-010`); `captureEvent(null, …)` path for unknown-subject events                                                                                                            | Funnel joinability: activated event carries store+product (`5.2-CON-011`) |
| 7   | Two new locale parity specs (10 catalogs × both surfaces), `APPROVED_COGNATES` handled; overflow assertion extended                                                                                                                                                                                            | Draft-translation release blocker recorded (process, not test)            |
| 8   | Full RLS actor matrix green in CI with the three tables in the worker-only block (`:2684-2753`, incl. the 42501 behavioral test); `5.2-DB-013`: authenticated Supabase client gets zero rows/denied on all three tables                                                                                        | Seed spec asserts `allowsCommerceSeeding()` guard                         |

### Unknown-subject and failure-path coverage (the "what fails?" set)

- `5.2-INT-040`: RC event, unknown `app_user_id` → 200, event row `user_id: null`, no entitlement write, no `api_error_occurred`.
- `5.2-INT-041`: Stripe event, unknown customer → same contract.
- `5.2-INT-042`: reconciliation drift — local `active`, ledger `expired` → downgrade + audit row; sweep-duty crash-isolation (a throw in one duty cannot kill the other); plus the Decision 4a bootstrap unit test proving both Job Schedulers are registered with the right cadences — the substrate is asserted, not assumed.
- `5.2-INT-043`: telemetry sink down → webhook still 200s, entitlement still transitions (fail-open, after commit).
- Pact resilience: 503/409/404 interactions exist so both consumers prove they _render_ failures, not just successes.

### Explicitly untested, stated plainly (5.1 honesty convention)

Real store purchases (StoreKit sandbox / Play internal testing E2E — deferred-work entry), real RevenueCat and Stripe webhook delivery latency, VoiceOver/TalkBack beyond the one-time new-control check, and anything behind `workflow_dispatch`-only CI (mobile E2E) or the no-CI integration tier — deferred-work #10 applies to every suite above marked integration; unit-cover the same branches for the ratchets.

## Dev Notes

### Current state of every file being modified (read them before editing)

- `apps/api/src/modules/commerce/commerce.module.ts:42-82` — providers/controllers lists and middleware binding; add the new siblings here. One-way dependency comment at `:26-34`.
- `apps/api/src/filters/api-exception.filter.ts` — the exclusion is the `TELEMETRY_EXCLUDED_ROUTES` string list at `:28-30` (it duplicates the path as a literal; it does not import the route constant) — add the two new webhook paths there.
- `apps/api/src/modules/commerce/commerce-retention.service.ts` — re-hosted per Decision 4a: `@Cron` removed, prune logic (now incl. `BillingEvent`) runs as the `commerce-retention-sweep` job; keep `PRUNE_BATCH_SIZE`/`MAX_PRUNE_BATCHES` semantics.
- `apps/api/src/config/queues.ts` (`QueueName` union + `queueConfigs`) and `apps/api/src/workers/bootstrap.ts` — Decision 4a's queue + two Job Schedulers; heed the one-bootstrap-per-queue warning at `bootstrap.ts:144-151`.
- `packages/config/src/flags.ts:44-69` + its three consumers (Decision 13).
- `packages/db/test/rls-policies.spec.ts` — category arrays at `:10-37` (don't touch), `targetTables:651-657` (worker-only tables deliberately absent), the **5.1 commerce worker-only block at `:2684-2753` (this is the template to extend)**; fixtures + cleanup mid-file.
- `apps/mobile/app/(tabs)/settings.tsx` — commerce section at `:327-378` is the pattern; new section is its sibling; state pattern at `:57-117`.
- `apps/web/src/app/settings/page.tsx` — 39 lines; add `<SubscriptionSection />` after `<CommercePreferencesSection />`; the docblock's four load-bearing attributes must survive.
- `apps/web/src/app/components/planner-rail.tsx` + `lookbook-prism-layout.tsx:55,228,392-403` — the rail's host state; gate per Decision 2; update the three pinned tests (the layout test's rail block spans `:96-108`).
- `packages/api-client/src/contracts/http/openapi.ts:52-71,91` — registry call list + version.
- `packages/api-client/src/types/analytics-events.ts` + `src/testing/analytics-event-assertions.ts` — the three-registry rule.
- `apps/api/src/modules/telemetry/telemetry.service.ts` — pseudonymous set at `:450`, builder table declared at `:457`.
- `pact/http/…` five files; `k6/helpers/config.ts` + `k6/tests/couture-api-baseline.k6test.ts`; `scripts/run-maestro.mjs` (don't edit — add package scripts); `.env.example`; `packages/db/prisma/seeds/{commerce,feature-flags}.ts`; `packages/testing/src/{factories,cleanup}`.

Anything a story task changes that is required for the system to keep working end-to-end is a requirement of this story whether or not an AC names it (create-story standing rule).

### What NOT to do (invention guards, learned from 5.1's 109-finding review)

- No age gate on purchasing. Product resolved 2026-08-11 for 5.1: no age-based commerce suppression; stores run their own parental-approval flows. If a reviewer reopens this, the recipe is `hasReachedAgeOfMajority(birthdate)` (`guardian.service.ts:257`), never `apiRole === 'teen'` (role ≠ age; a 25-year-old can still carry `teen`), and null birthdate must not suppress.
- No prices rendered by our API or clients (stores/Stripe render them); no currency/locale price presentation work (5.1 E-6 stays moot).
- No trial mechanics: Open question 2 is resolved as no-trial at launch, so do not configure a trial in Stripe/RevenueCat.
- No new `ApiRole`. `API_ROLES` stays `['guardian','teen','moderator','admin']`; premium is an entitlement lookup, not an identity role — a role would touch JWT issuance, `buildClaims`, and all four test-token bypasses.
- No socket push for entitlement changes in this story (deferred; polling + refresh meets the AC).
- Locale count is ten (repo reality) though the PRD commits to three; `APPROVED_COGNATES` will be needed — "Premium" is a cognate in most of the ten.

### Previous-story intelligence (5.1 dev record, distilled)

- Coordinator ran four peer worktree panes; the two costliest coordinator errors were shipping a non-typechecking foundation branch (Vitest transpiles without typechecking — run `typecheck` before handing off) and an integration-isolation scheme that had to be redone (partition by a filtered dimension, never park-and-restore shared rows).
- Verified-in-prod traps already fixed that this story inherits: `rawBody` on all three bootstraps; `api/index.ts` runs **without** `ApiExceptionFilter`/CORS/request-context (webhook behavior must not depend on any of those); CI DB roles exist and RLS negatives are falsifiable (PR #125).
- Honesty conventions: state plainly what was never executed (Maestro end-to-end, screen-reader passes, draft translations) rather than implying coverage.

### Git intelligence

Recent relevant commits: `6882aae` (5.1 — the 165-file template this story walks in), `0183954` (RLS falsifiability + CI grants), `8ad2a7e` (api-client 1.0.0 discriminated unions — response invariants are typed; follow the union style in `subscription.ts`).

### Latest tech notes (researched 2026-08-12, hardened by review; re-verify at implementation)

- `react-native-purchases` v10.7.0 (2026-08-06), StoreKit 2 + Play Billing 8; Play's Billing-8 deadline for app updates is 2026-08-31, with a self-service extension available to 2026-11-01 — pin a version that bundles Billing 8 regardless.
- `stripe` (node) v22.5.0, API `2026-07-29.dahlia`; webhook verify needs the raw body; Checkout + Customer Portal cover all lifecycle UI. RC's docs also recommend listening to `customer.subscription.created` as a forward trigger — record it as a `BillingEvent` and treat it as a redundant forward trigger (idempotent, same fetch token) alongside `checkout.session.completed`.
- RevenueCat free to $2,500 MTR — and **forwarded Stripe revenue counts toward MTR** (the ~1% at scale includes web revenue); confirm webhook + Stripe-integration availability on the free tier during provisioning. Webhook HMAC signing (`X-RevenueCat-Webhook-Signature`) preferred per Decision 1. `@apple/app-store-server-library` v3.1.0 is the first-party fallback path if Decision 1 is reversed.
- US anti-steering changes (Apple and Google, 2025-26) make external purchase links legal in US store apps — out of scope here, but it means the web Stripe rail may later be linkable from the apps; don't foreclose it.

### Project structure notes

New API files under `apps/api/src/modules/commerce/` (Decision 4 list); new libs `apps/{web,mobile}/src/lib/premium.ts`; new component `apps/web/src/app/components/subscription-section.tsx`; contract module `packages/api-client/src/contracts/http/subscription.ts`; factory `packages/testing/src/factories/premium.factory.ts`; migration under `packages/db/prisma/migrations/`; flows/specs per Tasks 8-9. Kebab-case files, feature-first, co-located specs — all existing conventions, no variances.

### References

- Epic contract: `_bmad-output/planning-artifacts/epics.md#Epic-5` (CC-5.2 at :429-436; gates CC-5.3/5.4/5.5 at :566)
- PRD: FR5.2 (`prd.md:202-203`), premium funnel metric (`:60`), NFR Security 4 (`:257`), NFR Localization (`:272-274`)
- Architecture: commerce module mapping (`architecture.md:109`), Stripe reservation (`:126`), experiments ADR-011, contract rules (`:167-189`)
- Story 5.1 + review log + `deferred-work.md` (esp. entries 2, 6, 10, 11) — the convention source for nearly every decision above
- Billing research (2026-08-12): RevenueCat releases/docs, stripe-node releases, Play Billing deprecation FAQ, App Store Server Notifications changelog (URLs in the research log; re-verify versions before pinning)

## Open questions (all resolved 2026-08-12 by the product owner; solo-maintainer project, so product, legal, and operator are the same person. Nothing blocks any task.)

1. **Vendor sign-off (Decision 1) — RESOLVED: RevenueCat, as conditioned.** The adversarial review's accept-with-conditions verdict stands and every condition is already encoded in Decision 1 (honest one-writer claim, verified scheduler substrate, outage/lag behavior, Web Billing rejection recorded, reversal cost stated, webhook signing preferred, `app_user_id` pseudonymization weighed). Task 10's ADR entry records this decision and weighs both architecture principles (free-tier launch posture for; vendor-minimalist philosophy against, accepted because RC replaces three verification stacks and two webhook endpoints). No further sign-off gate exists.
2. **Trial — RESOLVED: no trial at launch.** The PRD metric is amended in place (`prd.md:60`): the `≥ 12% trial` leg is removed and the convert leg restated as ≥ 8% of checkout starts converting within 60 days, which this story's server events make computable. No trial mechanics are configured anywhere (the test-plan rule stands). A trial, its `premium_trial_started` event, and a restored trial metric become a deliberate post-launch story if conversion data argues for one.
3. **Pricing — RESOLVED: launch defaults are `premium_monthly` $4.99 USD and `premium_annual` $39.99 USD** (annual ≈ 33% off, the standard 2-months-free shape). Set in Stripe Products/Prices and the store products at provisioning time per the runbook, per-locale currency presentation included. Nothing in code depends on the amounts, so repricing is config, not a release.
4. **Receipts and retention — RESOLVED: the projection posture and the 24-month horizon are signed off as designed.** Rationale: the authoritative signed receipts and full-fidelity financial records live at the processors (Stripe and RevenueCat dashboards), which is where disputes, refunds, and tax questions are worked; our `BillingEvent` rows are a pseudonymous operational projection, so long-horizon financial-records obligations attach to the processor records, which outlive our prune. If a jurisdiction-specific obligation on the projection itself ever surfaces, the change is one pruner constant.
5. **Processor-side erasure owner — RESOLVED: the future account-deletion story owns the wiring, and this line is the binding record.** That story must call `PremiumEntitlementService.eraseProcessorData(userId)` and may not ship without it; whoever drafts it inherits the requirement from here (grep for `eraseProcessorData` finds both this record and the exported service method). Until deletion exists the disclosure is acceptable as written: processors are named, shared data is minimal (account id, purchase state), and the operator can execute direct deletion requests at both processors in the interim.

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List

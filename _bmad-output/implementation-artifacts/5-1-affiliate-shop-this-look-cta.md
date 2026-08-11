---
baseline_commit: 2ad7fdc5ca837a093ebcae22fafc3f2f8a8c12d5
---

<!-- markdownlint-disable MD013 MD036 MD052 -->

# Story 5.1: Affiliate "Shop this look" CTA

Status: ready-for-dev

All decisions settled. **Decision 1** (minors and affiliate content) was
resolved 2026-08-11 by product: affiliate CTAs are shown to users under 18,
not suppressed by age.

This draft was reviewed by three independent blinded reviewers before any
implementation work. Their findings and the disposition of each, including the
thirteen deliberately skipped, are in `5-1-review-log.md`. Read it if you want
to know why a decision below is the way it is.

## Story

As a brand partner,
I want qualified traffic from outfit cards so that sponsored products convert.

## Epic contract and derived requirements

This story implements `epics.md` CC-5.1, whose entire contract is three
sentences. Everything else here is derived. The table below is the traceability
record: it says which story acceptance criteria carry the epic's contract and
which exist only because implementing that contract in this codebase requires
them. Test IDs trace to story ACs; this table is how a reviewer gets back to the
epic.

| Epic AC | Verbatim                                                                     | Story AC |
| ------- | ---------------------------------------------------------------------------- | -------- |
| 1       | "Embed disclosed 'Shop this look' button on eligible cards with partner ID." | AC 1     |
| 2       | "Track clicks and conversions via analytics + affiliate webhook."            | AC 2     |
| 3       | "Provide opt-out toggle in settings that hides CTAs."                        | AC 3     |

| Story AC | Source                                   | Why it exists                                                                                                              |
| -------- | ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| AC 1     | Epic AC 1                                | Direct.                                                                                                                    |
| AC 2     | Epic AC 2                                | Direct.                                                                                                                    |
| AC 3     | Epic AC 3, PRD FR5.1, PRD NFR Security 4 | Direct, plus the PRD's in-settings third-party disclosure.                                                                 |
| AC 4     | Derived                                  | This story adds durable commercial records next to a table pruned hourly. Without this AC the hazard is unguarded.         |
| AC 5     | Derived, CC-0.11 convention              | New user-scoped tables in this repo carry an RLS actor matrix.                                                             |
| AC 6     | Derived                                  | The catalog is operator-managed with no admin console, so a kill switch and a bad-data path are the only safe degradation. |
| AC 7     | Derived, CC-3.2 and CC-3.8 conventions   | New user-facing surfaces in this repo ship localized and accessible.                                                       |

**Prerequisites.** The epic lists CC-2.1 and CC-1.4; both are `done`. The epic's
list is incomplete for this codebase. This story additionally requires CC-4.1
and CC-4.2 (`GarmentItem.category`, `GarmentItem.comfort_range`, and the
`GarmentCategory` / `GarmentComfortRange` enums drive offer matching), CC-4.3
(the capsule selection path in `RitualService` must be preserved), CC-3.2
(locale catalogs and parity-test harness), CC-3.8 (the accessibility contract
the new Web page must satisfy), CC-0.7 (feature flags), CC-0.9 (contract-first
generation and Optic), and CC-0.11 (`private.can_manage_self_row`). All are
`done`.

The `sprint-status.yaml` rows for `epic-4` and `4-4` read `in-progress` on
`origin/main`, but 4.4's code is merged and present at this story's baseline
commit; the status update is a separate unpushed commit. Treat 4.4 as complete.

---

## Decisions requiring product sign-off

### Decision 1 (resolved 2026-08-11): minors and affiliate content

**This was a product and legal decision, not an engineering one.** An earlier
draft of this story locked a suppression rule unilaterally; that was wrong,
and its stated technical basis was also factually wrong (see below). It was
reframed as an open question and put to product directly.

**The question was:** CoutureCast is a 13+ product. The PRD's Executive
Summary names "teen students" as the first persona. Neither `epics.md` nor
`prd.md` restricts commerce by age. Should users under 18 see affiliate CTAs?

**Resolution: yes.** Affiliate CTAs are shown to users under 18 on the same
terms as adults. No age-based eligibility gate is implemented. This was a
deliberate choice, made with the regulatory consideration below on record,
not an oversight.

**What the PRD requires regardless of this decision:** clear disclosure, no
dark patterns around conversion prompts, and granular opt-out
([Source: prd.md#Success Criteria]). All are implemented below and were never
contingent on this decision.

**Regulatory consideration on record.** Advertising to identified minors
carries regulatory exposure the PRD does not analyze. Product accepted this
knowingly rather than defaulting to suppression.

**If this policy needs to reverse later:** do **not** key on
`apiRole === 'teen'`. That role is read verbatim from Supabase
`app_metadata.app_role` in
`apps/api/src/modules/auth/access-token-identity.service.ts:221-227` and is
never derived from age. The emancipation sweep in
`apps/api/src/modules/guardian/guardian.service.ts:908-1050` revokes
`GuardianConsent` rows and writes `UserProfile.preferences` markers; it does
not change the Supabase role. A user who signs up at 15 still has
`apiRole: 'teen'` at 25, so a role-keyed rule would silently disable commerce
for emancipated adults forever. Key on age instead:
`guardian.service.ts:257` already has `hasReachedAgeOfMajority(birthdate,
today)`. A `UserProfile.birthdate` that is null (the column is nullable,
`schema.prisma:181`) must **not** suppress — suppressing on unknown age would
disable commerce for every legacy account; record the count of null-birthdate
users who saw a CTA as an operational metric instead.

Task 3 exports a stub predicate, `isAffiliateAudienceEligible(profile)`, that
currently always returns `true`, with this decision recorded in its doc
comment. It is **not** wired into decision 4's eligibility chain, so reversing
this policy later is: implement the age check inside the existing stub, then
add it back as a step in decision 4. No call site changes.

---

## Locked decisions

Everything below is settled. Implement as written.

### 1. Scope

**In scope:** a minimal operator-managed partner and offer catalog; server-side
eligibility on `GET /api/v1/ritual`; a disclosed CTA on the Mobile outfit card;
an attributed click endpoint; an HMAC-authenticated conversion webhook; a
user-level opt-out enforced server-side and exposed in Mobile settings and a new
Web settings page; three analytics events.

**Out of scope, with reasons:**

- **Premium entitlements, paywalls, Stripe.** CC-5.2 owns these and depends on
  this story. Add no entitlement check anywhere.
- **A Web outfit-card CTA.** See decision 2.
- **A partner-facing admin console.** Catalog rows are seed and migration
  managed. Logged in `deferred-work.md`.
- **Per-partner payload adapters.** One canonical webhook payload; partners
  conform to it.
- **Commission, payout, or reconciliation reporting.**
- **The outfit detail view CTA** named in PRD Key Interactions
  ("full-screen look with garment cards ... optional click-to-buy buttons").
  That surface does not exist in the codebase. Log it in `deferred-work.md`.
- **Weekly affiliate link validation** required by PRD NFR Integration 2. This
  story validates per request only. A scheduled validation job is a real gap,
  not an oversight; log it in `deferred-work.md` with the PRD citation.

**Known adjacent defect, deliberately deferred.**
`apps/web/src/app/components/lookbook-prism-layout.tsx:41-47` defines a
hardcoded `HERO_RECOMMENDATIONS.Sponsored` entry whose `eyebrow` field reads
`'Sponsored Selection'`. It is reachable in the UI: `CHIP_DEFAULT_FILTER.Sponsored`
is set at line 20 and `apps/web/src/app/lib/deep-link-handler.ts:39` routes the
`evening` deep link to that chip. It is Story 3.5 placeholder copy with no
partner behind it, and rewriting it inside a commerce story risks implying a
sponsorship that does not exist. Log it in `deferred-work.md` as a
disclosure-copy defect, noting the deep-link reachability. Do not change it
here.

### 2. Surfaces

Exactly one surface renders a card fed by real `/api/v1/ritual` data:
`apps/mobile/app/(tabs)/index.tsx:648` renders `OutfitRecommendationCard`.
`apps/web/src/app/components/lookbook-prism-layout.tsx` renders a hardcoded
constant and never calls the ritual endpoint;
`apps/web/src/app/page.tsx` is a marketing page.

- **CTA: Mobile only.** Building a live Web ritual surface is multi-story work
  that belongs to Epic 3.
- **Opt-out toggle: Mobile and Web.** The epic AC says "in settings" without
  qualifying a surface, and this repo ships cross-surface controls for
  cross-surface features (CC-4.3, CC-4.4). Web's `/settings` is a five-line stub
  today; replacing it is a bounded expansion. Test convenience is **not** a
  reason to build a product surface; if the Web page is cut in review, AC 3 is
  still satisfiable by the Mobile toggle alone and Task 7 drops whole.
- **Widgets and watchOS: out.** Neither has a browser handoff or room for a
  disclosure, and an undisclosed affiliate tap target would violate the PRD
  guardrail.

### 3. One offer, one partner, one control

The epic says "**button**" and "**partner ID**", both singular. Honour that
literally.

- Eligibility selects **exactly one** `AffiliateOffer` per scenario outfit.
- That offer's partner is **the** partner for that card. The disclosure names
  it; `partner_id` in analytics is unambiguous; the click maps to one
  `offer_id`.
- There is no offer array, no `offer_count`, no per-item link list, and no
  "at most three" cap. An earlier draft carried a three-offer cap that appears
  nowhere in `epics.md` or `prd.md` and left the offer-to-control mapping
  undefined. It is gone.

PRD FR5.1's "links on outfit **items**" is broader than this. It is satisfiable
later by adding offers per item without changing the contract shape, since the
block is a single object today and a future array field is additive. Note the
narrowing in `deferred-work.md`.

### 4. Eligibility, evaluated server-side in this exact order

Short-circuit on the first failure. (`isAffiliateAudienceEligible(profile)`,
Decision 1, is not a step here — it always returns `true` today, so it is
called nowhere in this chain. See Decision 1 for how to wire it back in if
the policy reverses.)

1. `commerce_affiliate_enabled` resolves truthy for the acting user through
   `FeatureFlagsService.getFeatureFlag`.
2. `CommercePreference.affiliate_ctas_enabled` is `true`. A missing row means
   the default `true`.
3. Exactly one active offer resolves for the outfit (below).

Any failure emits `shopThisLook: null`.

**Slot derivation.** For each entry in `outfit.garmentIds`:

- `default-{category}` yields `(category, comfortRange: null)`. Placeholders
  match only wildcard offers. The scenario's `targetComfortRange` is computed
  inside `if (!recommendation || isStale)` in `ritual.service.ts` and is
  **not** in scope on the warm-cache path, so it cannot be used.
- A real `GarmentItem.id` yields the row's `category` and `comfort_range`. One
  batched `findMany` over the outfit's real IDs, scoped to the acting user. A
  `null` category contributes no slot.

**Offer selection.** Over all derived slots, select rows where
`status = 'active'`, `effective_from <= now`, `(effective_to IS NULL OR now < effective_to)`,
`locale_region` matches, `garment_category` matches the slot, and
`(comfort_range = slot.comfortRange OR comfort_range IS NULL)`. Order by:

```sql
ORDER BY (comfort_range IS NULL) ASC,   -- exact beats wildcard
         priority DESC,
         id ASC                          -- total tie-break
LIMIT 1
```

Exactness beats priority. The `id ASC` tie-break makes the result total, which
is what keeps attribution comparable and E2E non-flaky.

**Boundaries.** `effective_from` inclusive, `effective_to` exclusive, `NULL`
`effective_to` means open-ended. The clock is the database's `now()` inside the
same query, so tests are deterministic against a single clock.

**`locale_region`.** This is the **UI-language region**, not a commerce
jurisdiction. It is the uppercased region subtag of the locale the ritual
already resolves (`ritual.service.ts:913-926`: `UserProfile.preferences.locale`
→ `?locale=` → `Accept-Language`): `en-US` → `US`, `fr-CA` → `CA`, `es-419` →
`419` (a UN M.49 macro-region, not a country). A locale with no region subtag
and a request with no resolvable locale both yield the sentinel `'*'`, which
catalog rows may carry to publish globally. State this plainly in the column
comment: a US user reading the app in `fr-FR` gets `FR` offers. A real
jurisdiction source does not exist in this codebase; introducing one is a
separate story. Log it in `deferred-work.md`.

`locale_region` carries a check constraint: `'*'`, or two to three characters
matching `^[A-Z0-9]{2,3}$`.

### 5. Assembly point: the controller, not the service

`RitualService` has no single "after the cache read" point. `ritual.service.ts:1060`
returns `cachedPayload.data` at step 3, before forecast-segment resolution
(line 1067), before the garment query (line 1160), and 560 lines before response
assembly (line 1602). On that path neither `segment`, `adjustedFeelsLike`, nor
`comfortPrefs` is in scope.

**Assemble the commerce block in `RitualController.getOrCreateRitual`**
(`apps/api/src/modules/personalization/ritual.controller.ts:46-55`), between the
service call and `ritualResponseSchema.parse({ data })` at line 55. Every path
passes through it.

This also avoids touching `RitualService`'s constructor, which is instantiated
positionally at twelve sites in `ritual.service.spec.ts` (lines 242, 366, 403,
545, 621, 649, 682, 699, 718, 752, 801, 910) with no DI container.

**Consequence, stated so nobody re-derives it:** `shopThisLook` is never written
into the Redis or database recommendation cache, and toggling the preference
performs no cache invalidation. The rejected alternative, a commerce revision in
the ritual cache key, multiplies entries by preference state and makes a catalog
edit evict every user's personalization cache.

### 6. Mobile's device cache must not defeat the opt-out

The server side of decision 5 is not sufficient. The client caches too:

- `apps/mobile/app/(tabs)/index.tsx:196-206` — `loadData` returns
  `readLatestRitualCache(...)` before any network call when under 15 minutes
  old.
- Lines 216-220 persist the entire fetched `RitualResponse` via
  `saveRitualCache`.
- Lines 243-246 serve that cache with **no age bound** on network failure.

**Strip `shopThisLook` before `saveRitualCache`**, and never render a CTA from a
cache-served payload. Otherwise the CTA survives an opt-out for fifteen minutes
online and indefinitely offline, which reads as a broken opt-out.

### 7. Attribution: mint on click, with an opaque token

`GET /api/v1/ritual` returns offer metadata and no token. On activation the
client calls `POST /api/v1/commerce/affiliate/clicks`; the API creates one
`AffiliateClick`, builds the outbound URL, and returns
`{ data: { redirectUrl } }`.

Why not mint at render: ritual is fetched on every foreground, so a render-time
token writes a durable row per render for a link most users never tap, and the
15-minute cache would either reuse one token across the window or force the
commerce block out of the cache anyway.

**Request body** (`POST /api/v1/commerce/affiliate/clicks`):

```jsonc
{
  "offerId": "string, 1..64",
  "recommendationId": "string, the ScenarioOutfit.id the CTA was rendered on",
  "surface": "mobile_hero", // enum, currently one member
}
```

`scenario` and `localeRegion` are **derived server-side** from the
recommendation and the resolved locale, never trusted from the client.
`surface` is a closed enum so it cannot become free text. Success is **201**
on a fresh mint and **200** on a deduped replay, matching the
`createMyFormUploadUrl` / `commitGarment` convention. Per the Story 4.4 lesson,
that distinction needs one assertion that actually goes over HTTP.

**Client token, not the row id.** `AffiliateClick.id` stays internal.
A separate `token` column carries an HMAC-SHA256 over the row id keyed by
`COMMERCE_CLICK_TOKEN_SECRET`, base64url, unique-indexed. That token is what
goes in the outbound URL and what the webhook joins on. A raw cuid in a
third-party URL, combined with "an unknown token returns 200", would let any
holder of a partner secret attribute revenue to guessed identifiers. The repo
already avoids this exact shape: `wardrobe-upload-token.ts` HMACs a session id
rather than exposing the row id.

**Dedupe.** If a click exists for the same `(user_id, offer_id, recommendation_id)`
with `created_at > now() - interval '60 seconds'` (strictly greater; the 60.000s
boundary is a miss), return that row's `redirectUrl` with no new row and no
second analytics event. Both sides of the boundary are tested. Concurrency is
handled by a partial unique index on
`(user_id, offer_id, recommendation_id, date_trunc('minute', created_at))` plus
an insert-conflict retry that re-reads the winner; the plain index in an earlier
draft could not prevent a concurrent double-insert that a required test asserts
against.

**URL construction.** `deep_link_template` contains the literal `{clickToken}`.
Substitute the token. Before redirecting, assert the resolved URL parses, uses
`https`, has no userinfo component, and its lowercased hostname equals the
partner's `allowed_host` exactly or is a dot-suffix of it
(`shop.example.com` matches `example.com`; `notexample.com` does not). Compare
after IDN normalization via `new URL(...).hostname`. A template with no
`{clickToken}` placeholder is rejected by the same path.

**Bad offer data is an operator error surfaced as a user-visible failure.** PRD
NFR Integration 2 asks for a neutral-card fallback when a partner feed is
unavailable; this story does not implement one, because there is no feed and no
validation job. Instead, an invalid resolved URL returns `500` with the message
`Affiliate offer is not configured correctly.`, creates no click row, and logs
at `error`. The client shows the localized generic failure. Log the missing
neutral-fallback behaviour in `deferred-work.md` with the PRD citation.

**Failure handling.** If the click call fails, show an inline localized error
and **do not navigate**. Unattributed traffic is worthless to the partner and
unauditable. If the browser handoff itself fails after a successful mint, show
the same error; the click row and its event stand, and no compensating event is
emitted. There is no popup blocker here because the CTA is mobile-only; a future
Web port must issue the call inside the user-gesture task.

**Browser handoff.** Use `WebBrowser.openBrowserAsync`, reusing the pattern in
`apps/mobile/components/external-link.tsx:20-27`. `Linking.openURL` appears
nowhere in this repo. Because that opens an in-app browser, the localized string
is `"Opens in an in-app browser"`, not "your browser".

### 8. Inbound webhook

The endpoint is new, but the crypto pattern is not. Reuse the structure of
`apps/api/src/modules/wardrobe/wardrobe-upload-token.ts:8-46`: a `requireSecret`
helper with a ≥32-character guard and an `allowsTestOnlySecrets()` fallback
(`apps/api/src/config/runtime-environment.ts`), `createHmac('sha256', secret)`,
and a byte-length check before `timingSafeEqual` with the RangeError hazard
noted in a comment. `guardian.service.ts:184-200` is a second precedent.

**Endpoint.** `POST /api/v1/commerce/affiliate/webhook`, machine-to-machine.

There is **no global auth wiring** in this app: `app.module.ts:48-50` registers
no `APP_GUARD`, and `RequestAuthGuard` is applied per controller with
`@UseGuards`. So the instruction is simply: omit `@UseGuards` on this
controller, and assert by supertest that the route is reachable with no
`Authorization` header.

**Headers.** `x-couture-partner-id` (the partner slug), `x-couture-timestamp`
(integer Unix seconds), `x-couture-signature` (lowercase hex HMAC-SHA256 over
`` `${timestamp}.${rawBody}` ``).

**Verification, in order.** Every failure below returns the same status and
message so the endpoint is not a partner-enumeration oracle.

1. Any header missing, or the timestamp not an integer → `401`.
2. Partner slug unknown, `inactive`, or its secret env var unset or under 32
   characters → `401`.
3. Timestamp more than 300 seconds from server time in either direction → `401`.
4. HMAC over the **raw body bytes** mismatched → `401`.
5. Only then parse with Zod. Failure → `400`.

All `401`s carry the message `Invalid webhook signature.` The `400` carries the
standard validation message.

**Raw body: three bootstraps, not one.** `NestFactory.create` is called in three
places and the deployed one is not `src/main.ts`:

- `apps/api/src/main.ts:55` — local `start:dev` / `start:prod`.
- `apps/api/api/index.ts:12-14` — the **deployed** entry.
  `apps/api/vercel.json:4-8` maps `functions: { "api/index.ts": ... }` and
  rewrites `/(.*)` → `/api/index`. Preview and production never touch
  `src/main.ts`.
- Test bootstraps: `moduleFixture.createNestApplication()` with no options, at
  `apps/api/integration/http-contract-parity.integration.spec.ts:131`,
  `apps/api/integration/alerts.integration.spec.ts:278`,
  `apps/api/src/modules/personalization/ritual.controller.spec.ts:265`, and
  others.

Set `rawBody: true` on **all three**. Without it on `api/index.ts` every signed
webhook 401s in preview and production. Without it on the `TestingModule` the
raw-body proof test silently exercises a `rawBody === undefined` path and passes
for the wrong reason. Note also that `api/index.ts` does not install
`ApiExceptionFilter`, CORS, or the request-context middleware that
`src/main.ts:64-73` installs; the ACs describe the `src/main.ts` bootstrap, and
any behaviour difference is a finding to raise, not to paper over.

**Payload.**

```jsonc
{
  "eventId": "partner-side unique id, 1..128 chars",
  "clickToken": "the token we issued",
  "occurredAt": "ISO 8601 UTC",
  "status": "pending | confirmed | reversed",
  "orderValueMinorUnits": 12900,
  "currency": "ISO 4217 alpha-3",
}
```

Money is integer minor units. Floating-point money is prohibited.

**Append-only, which removes the ordering problem entirely.** One
`AffiliateConversion` row per `(partner_id, external_event_id)`, unique-indexed.
Rows are never updated. There is no last-write-wins rule, no `occurredAt`
comparison, no equal-timestamp tie-break, and no forbidden-transition table,
because nothing mutates. A click's current attribution state is the row with the
greatest `occurredAt` for that click, computed at read time by whoever reports
on it. An earlier draft mixed a per-event unique key with per-click mutation
semantics; the two cannot both hold.

- A replayed `eventId` returns `200`, writes nothing, emits nothing.
- An unknown `clickToken` persists the row with `affiliate_click_id = null` and
  returns `200`. Rejecting would trigger unbounded partner retries for a fact we
  cannot change.
- **The kill switch does not apply here.** The webhook always records. Returning
  `503` to a retrying partner while the flag is off is exactly the retry storm
  the previous rule exists to avoid, and it would drop conversion facts for
  purchases that already happened. The flag gates the CTA and the click
  endpoint only. This also removes the question of how to evaluate a per-user
  flag on a request with no user.

**Retention.** `AffiliateClick` and `AffiliateConversion` are commercial
records. `TelemetryService.pruneOldTelemetryEvents` must not touch them and its
24-hour window must not be generalized. Their own retention period is
**24 months from `created_at` / `received_at`**, enforced by a separate monthly
pruner in the commerce module, chosen to exceed the longest plausible partner
reconciliation window. Account deletion is handled by `onDelete: Cascade` from
`User` on `AffiliateClick`; `AffiliateConversion.affiliate_click_id` is
`onDelete: SetNull`, so settled conversions survive a user erasure as
unattributed financial facts while the personal link is destroyed.

### 9. Error responses use status codes and messages, not codes

`packages/api-client/src/contracts/http/common.ts:24-78` — every shared error
schema is `.strict()` over exactly `{ statusCode, message, error }`. There is no
`code` field and `.strict()` rejects one. The only error-code concept in the
repo is `getErrorCodeForStatus` in
`apps/api/src/filters/api-exception.filter.ts:15-27`, which feeds **telemetry**,
never a response body.

So: **no `COMMERCE_*` codes on the wire.** Use the shared error schemas
unchanged and assert on status plus these exact messages, declared as exported
constants in `commerce.ts` so tests and controllers cannot drift:

| Status | Constant                               | Message                                                   |
| ------ | -------------------------------------- | --------------------------------------------------------- |
| 401    | `WEBHOOK_SIGNATURE_INVALID_MESSAGE`    | `Invalid webhook signature.`                              |
| 403    | `COMMERCE_OPTED_OUT_MESSAGE`           | `Affiliate suggestions are turned off for this account.`  |
| 403    | `COMMERCE_AUDIENCE_INELIGIBLE_MESSAGE` | `Affiliate suggestions are unavailable for this account.` |
| 404    | `COMMERCE_OFFER_NOT_FOUND_MESSAGE`     | `Affiliate offer not found.`                              |
| 500    | `COMMERCE_OFFER_INVALID_MESSAGE`       | `Affiliate offer is not configured correctly.`            |
| 503    | `COMMERCE_DISABLED_MESSAGE`            | `Affiliate suggestions are temporarily unavailable.`      |

**Evaluation order on the click endpoint,** so status assertions are
deterministic: `503` (flag off) → `403` audience → `403` opted out → `404`
unknown, inactive, or out-of-window offer → `500` invalid resolved URL. The kill
switch outranks everything: a disabled feature reports as disabled, not as a
permission problem.

**The preferences endpoints are not gated by the flag.** A user must always be
able to read and set their own preference, including while commerce is switched
off. The settings section renders unconditionally.

**AC 2's "writes nothing" is scoped to commerce tables.** `ApiExceptionFilter`
(`main.ts:73`, filter lines 41-72) fires `api_error_occurred` for every
`HttpException`, which persists a `TelemetryEvent` row. So every rejected
webhook writes one. Two consequences: the ACs say "creates no
`AffiliateClick` and no `AffiliateConversion` row", and the webhook controller
is **excluded** from `api_error_occurred` capture, because an unauthenticated
endpoint that writes a row per rejected request is a free amplification vector
against a table pruned only hourly. Implement the exclusion by route path in the
filter and test it.

### 10. Data model

Five models in `packages/db/prisma/schema.prisma`, one migration. All ids are
`@default(cuid())` except where stated; all carry `created_at` and `updated_at`
except `AffiliateClick` (`created_at` only) and `AffiliateConversion`
(`received_at` default now, plus `occurred_at`).

Enums, lowercase members matching their JSON representations one-to-one so no
mapping layer is needed:

```prisma
enum CommercePartnerStatus     { active  inactive }
enum AffiliateOfferStatus      { active  inactive }
enum AffiliateConversionStatus { pending confirmed reversed }
```

1. **`CommercePartner`** — `slug @unique`, `display_name`, `allowed_host`,
   `status CommercePartnerStatus @default(inactive)`, `webhook_secret_ref`.
2. **`AffiliateOffer`** — `partner_id`, `garment_category GarmentCategory`,
   `comfort_range GarmentComfortRange?` (null is the wildcard), `locale_region`,
   `title`, `deep_link_template`, `priority Int @default(0)`,
   `status AffiliateOfferStatus @default(inactive)`, `effective_from`,
   `effective_to DateTime?`. Index
   `([status, locale_region, garment_category, priority(sort: Desc)])`.
3. **`CommercePreference`** — `user_id @unique`,
   `affiliate_ctas_enabled Boolean @default(true)`, `onDelete: Cascade`.
4. **`AffiliateClick`** — `token @unique`, `user_id`, `offer_id`, `partner_id`,
   `recommendation_id`, `scenario`, `surface`, `locale_region`, `created_at`.
   `onDelete: Cascade` from `User`. Plus the partial unique index in decision 7
   and an index on `created_at` for the pruner.
5. **`AffiliateConversion`** — `partner_id`, `external_event_id`,
   `affiliate_click_id String?` (`onDelete: SetNull`),
   `status AffiliateConversionStatus`, `order_value_minor_units Int`,
   `currency String`, `occurred_at`, `received_at`,
   `@@unique([partner_id, external_event_id])`.

Check constraints: `order_value_minor_units >= 0`, `currency ~ '^[A-Z]{3}$'`,
and the `locale_region` constraint from decision 4.

**`webhook_secret_ref` is a constrained name, not a free lookup.** Reading
`process.env[<value from a database row>]` is an unbounded read of any
environment variable. Constrain it: a check constraint requiring
`^COMMERCE_PARTNER_[A-Z0-9_]{1,40}_WEBHOOK_SECRET$`, and a second runtime guard
rejecting any resolved name that fails the same pattern. Secret values never
enter the database, a log line, a fixture, or a commit.

**RLS.**

- `CommercePreference` and `AffiliateClick` are **owner-only** via
  `private.can_manage_self_row("user_id")`, **not** guardian-shared. A
  purchase-intent trail is not something this story has a mandate to expose to a
  guardian.
- `CommercePartner`, `AffiliateOffer`, `AffiliateConversion` carry no `user_id`.
  Enable RLS, grant the `authenticated` role nothing. Model this on the
  worker-only block at `packages/db/test/rls-policies.spec.ts:631`.
- `packages/db/test/rls-policies.spec.ts:10-31` holds three hard-coded `as const`
  table arrays; the suite asserts `rlsState.rows` length equals the derived
  target count (line 566) and asserts an **exact** policy-name set per table
  (600-608). So the migration's policy names are load-bearing. Add
  `CommercePreference` and `AffiliateClick` to `selfOnlyTables` with exactly
  `authenticated_read_own_user_data`, `authenticated_insert_own_user_data`,
  `authenticated_update_own_user_data`, `authenticated_delete_own_user_data`.

### 11. Contracts

New module `packages/api-client/src/contracts/http/commerce.ts`.

```ts
export const affiliateSurfaceSchema = z.enum(['mobile_hero'])

export const shopThisLookSchema = z
  .object({
    partnerId: nonEmptyStringSchema.describe(
      'CommercePartner.slug. Stable, safe to log.'
    ),
    partnerDisplayName: nonEmptyStringSchema.describe('Rendered next to the CTA.'),
    offerId: nonEmptyStringSchema.describe(
      'Pass back to POST /api/v1/commerce/affiliate/clicks.'
    ),
    offerTitle: nonEmptyStringSchema.describe(
      'Partner-authored, already localized by the catalog row.'
    ),
    garmentCategory: garmentCategorySchema.describe(
      'The outfit slot this offer matched.'
    ),
  })
  .strict()
```

The block carries **no URL**: the deep link is built server-side on click and
never reaches the client. Disclosure copy is a client-side i18n key, not a
server string, so it stays reviewable in the locale catalogs.

`ritual.ts` gains exactly one field:

```ts
shopThisLook: shopThisLookSchema.nullable()
```

**Nullable, not optional.** The API always serializes the key. An earlier draft
had `.nullable().optional()`, which recreates the absent-versus-null ambiguity
the design exists to avoid. `scenarioOutfitSchema` is not `.strict()`
(`ritual.ts:10-48`), so this is additive and Optic's `breaking-changes` ruleset
passes. Bump `info.version` `1.0.0` → `1.1.0` anyway; the published contract
gained operations and a field.

**Endpoints.**

| Method | Path                                 | Auth   | Success                                  |
| ------ | ------------------------------------ | ------ | ---------------------------------------- |
| `GET`  | `/api/v1/commerce/preferences`       | Bearer | 200                                      |
| `PUT`  | `/api/v1/commerce/preferences`       | Bearer | 200, including an unchanged value        |
| `POST` | `/api/v1/commerce/affiliate/clicks`  | Bearer | 201 fresh, 200 deduped                   |
| `POST` | `/api/v1/commerce/affiliate/webhook` | HMAC   | 200, body `{ data: { received: true } }` |

**Barrels and re-exports.** Adding the file to `contracts/http/index.ts` is not
enough:

- `packages/api-client/src/index.ts:3-31` hand-lists a subset of contract
  exports and does not `export *`. Clients must import from the deep subpath
  `@couture/api-client/contracts/http`, which is what
  `apps/mobile/components/hero/outfit-recommendation-card.tsx:4` and
  `apps/web/src/lib/wardrobe.ts:3-27` already do. No `index.ts` edit is needed
  if that path is used; use it.
- `apps/api/src/contracts/http.ts:7-105` is a hand-maintained named re-export
  block that every API controller imports through. It **must** be extended.

**Refinements need descriptions.**
`packages/api-client/testing/contract-invariants-documented.spec.ts` walks
everything exported from `src/contracts/http` and fails any `ZodEffects`
refinement lacking `.openapi({ description })`. Prefer structural constraints
(`.min()`, `.max()`, enums, `.strict()`) which reach the published spec;
document any `.refine()` that survives.

**Cache headers.** Use a `CommerceCacheHeadersMiddleware` applied in
`CommerceModule.configure(...)` over `/api/v1/commerce{/*path}`, mirroring
`apps/api/src/modules/wardrobe/wardrobe.module.ts:100-119`. Not per-handler
`@Header`: the comment at `wardrobe-capsule.controller.ts:33-36` explains why a
header set after the service call is never applied when the service throws, and
this story's whole point includes 403/404/500/503 paths.

### 12. Analytics

| Event                           | Emitted by                  | Properties                                                                            |
| ------------------------------- | --------------------------- | ------------------------------------------------------------------------------------- |
| `affiliate_cta_shown`           | Mobile client, PostHog only | `partner_id`, `scenario`, `surface`, `locale_region`, `recommendation_id`             |
| `affiliate_cta_clicked`         | API                         | `partner_id`, `offer_id`, `scenario`, `surface`, `locale_region`, `recommendation_id` |
| `affiliate_conversion_recorded` | API                         | `partner_id`, `status`, `currency`, `order_value_minor_units`, `matched`              |

**`affiliate_cta_shown` is client-side only.** It uses the mobile analytics
client's own `distinctId`, exactly like `trackMobileRitualCreated` and
`trackMobileLocaleSwitched` in `apps/mobile/src/analytics/track-events.ts`. It
does **not** go through `TelemetryService` and does **not** write a
`TelemetryEvent` row. A mobile client cannot compute a server-side HMAC subject
and cannot write that table; an earlier draft required both.

**`recommendation_id` is the `ScenarioOutfit.id`.** It solves three problems at
once: it is the once-per-payload dedupe key the client needs, it is the join key
between impression and click, and it is the correlation key that makes the PRD's
"≥6% of outfit sessions trigger a brand click-to-buy" metric computable. Without
it that metric has no denominator. It is a synthetic server id and carries no
user identity in the property itself; note in the property's doc comment that it
is DB-joinable to a user, which is the deliberate tradeoff that makes the metric
work.

**Server events.**

- `distinctId` is the HMAC `analyticsSubjectId` from `buildAnalyticsSubjectId`,
  never a raw `user_id`. That function is currently module-private at
  `telemetry.service.ts:154`; export it.
- `$ip: null`, and `TelemetryEvent.user_id: null` (the column is nullable,
  `schema.prisma:650-651`, so no migration).
- `affiliate_conversion_recorded` has no user subject when unmatched: use the
  partner slug as `distinctId` and `matched: false`. When matched, load the
  click's `user_id` and HMAC it, and set `matched: true`.
- No URL, product title, garment id, or free text ever enters a property.
  Negative fixtures prove the allowlists reject them.

**`TelemetryService` needs generalizing, not another ternary arm.**
`telemetry.service.ts:396-404` is a literal two-value ternary chain and
lines 405-407 are a hard-coded two-value disjunction gating `user_id: null`, the
persisted-properties choice, and `$ip: null`. Replace the disjunction with a
`PSEUDONYMOUS_EVENT_TYPES` set and the ternary chain with a second builder table
keyed by event name, then register the two server events. Exercise
`captureEvent(null, 'affiliate_conversion_recorded', ...)` explicitly, since it
has no user on any path.

**Three registries, not one.** Adding a name to `analyticsEventNameSchema`
requires:

- `packages/api-client/src/types/analytics-events.ts:407-433` — `analyticsEventSchemas`.
  `packages/api-client/testing/analytics-events.spec.ts:49-51` asserts the two
  key sets are equal, so a name without a schema fails the suite.
- `packages/api-client/src/testing/analytics-event-assertions.ts:40` —
  `analyticsPropertySchemas`, used by every cross-surface assertion helper.

**Emission timing on click, stated once.** Emit `affiliate_cta_clicked`
**after** the click row commits, fail-open, never failing the request. There is
no telemetry-claim row and no rollback-on-telemetry-failure behaviour; an
earlier draft contradicted itself across three places. A degraded PostHog must
never drop a commercial click record.

### 13. Feature flag and audit

Add `commerce_affiliate_enabled` to `FEATURE_FLAG_DEFINITIONS` in
`packages/config/src/flags.ts`, `kind: 'boolean'`, `defaultValue: false`. Four
files consume the key list:

- `packages/config/src/flags.spec.ts:12` asserts the exact `FEATURE_FLAG_KEYS`
  array; line 36-42 asserts every flag has a boolean default.
- `packages/db/prisma/seeds/feature-flags.ts:17,46` maps `FEATURE_FLAG_KEYS`
  into seeded rows, so `db:seed` / `db:reset` output changes. This is also how
  non-production environments turn the feature on (decision 14).
- `apps/api/src/modules/feature-flags/feature-flags.service.spec.ts:127` builds
  a per-key expectation.

The flag falls back to the `FeatureFlag` cache row and only then to the `false`
code default, so a degraded PostHog cannot switch commerce on by accident.

**Audit.** Every change to `affiliate_ctas_enabled` writes an `AuditLog` row in
the same transaction: `user_id` = the acting user, `event_type` =
`'commerce_affiliate_opt_out_changed'` (the column is a plain `String`,
`schema.prisma:629`, so no enum change), `event_data` = `{ enabled: boolean }`,
`ip_address` from the request context. An unchanged value writes no row and
returns `200` with the current state, so the response is uniform.

This is not a PRD requirement. PRD NFR Security 3 scopes its audit trail to
moderation actions; NFR Security 4 requires disclosure and toggles, not audit
rows. An earlier draft cited "auditable" as PRD language and it is not. Keeping
the audit row is a deliberate local choice for a commercial consent signal.

### 14. Making the feature reachable

Three independent gates default to off, so without this section AC 1's positive
path cannot be demonstrated anywhere, and the E2E tasks would be uncloseable.

- **Catalog.** Add `packages/db/prisma/seeds/commerce.ts` and wire it into
  `packages/db/prisma/seeds/index.ts` (imports at lines 5-10, ordered `main()`
  at 15-23; note the `.js` relative-import convention and the deterministic
  `faker.seed(4242)` at line 16). Seed one **active** partner
  (`slug: 'sample-partner'`, `allowed_host: 'partner.couturecast.test'`) and
  active wildcard offers covering `top`, `bottom`, `dress`, and `shoes` at
  `locale_region: '*'`. Synthetic host, never a real domain. Guard the whole
  seed behind `allowsTestOnlySecrets()` so it never runs against production.
  The file `packages/db/prisma/seed.ts` does not exist; do not create it.
- **Flag.** The same non-production guard seeds
  `commerce_affiliate_enabled: true` into the `FeatureFlag` table.
  `playwright/global-teardown.ts:21-45` runs `db:reset`, so seeded state is what
  E2E sees.
- **Secret.** `COMMERCE_PARTNER_SAMPLE_PARTNER_WEBHOOK_SECRET` resolves through
  `allowsTestOnlySecrets()` in non-production, matching
  `requireUploadTokenSecret`.

Task 9's E2E therefore uses **seeded catalog plus public-API user setup**, not
public-API catalog setup. There is no public catalog API and there is not
supposed to be one.

**Operator runbook for a real partner** (no admin console exists): insert
`CommercePartner` and `AffiliateOffer` rows via migration or service-role SQL,
set the partner's secret env var in the target environment, then enable
`commerce_affiliate_enabled` in PostHog. Document this in
`_bmad-output/project-knowledge/secrets-management.md`. Name the owner in the
PR description.

### 15. Disclosure

PRD FR5.1's acceptance is "Disclosures visible before click".

**At the CTA.** The disclosure renders adjacent to the control in the same
visual block, in reading order **before** it, never in a post-tap interstitial,
never behind a tooltip, never only as an accessibility label. The partner
display name renders in the block. `en-US` source:
`"Paid partnership. CoutureCast may earn a commission."`

**In settings.** PRD NFR Security 4 requires third-party integrations to carry
"explicit disclosure **and** opt-in/out toggles within settings". The toggle
alone does not satisfy it. The commerce settings section renders a disclosure
paragraph naming what is shared and with whom, above the toggle.

**Opt-out, not opt-in.** Epic AC 3 says "opt-out toggle" and takes priority over
the PRD's looser "opt-in/out" phrasing. `affiliate_ctas_enabled` defaults
`true`. Note the tension in `deferred-work.md`: the single toggle controls CTA
visibility, and `AffiliateClick` rows are durable user-scoped commercial records
created only by an explicit tap.

### 16. Localization

Ten catalogs per surface, verified present: `de-DE`, `en-CA`, `en-US`,
`es-419`, `fr-CA`, `fr-FR`, `it-IT`, `pt-BR`, `pt-PT`, `tr-TR`, under
`apps/web/src/i18n/locales/` and `apps/mobile/assets/locales/`. The PRD commits
to three languages; ten is repo reality and the parity tests require all ten.

```json
{
  "commerce": {
    "shopThisLook": {
      "cta": "Shop this look",
      "disclosure": "Paid partnership. CoutureCast may earn a commission.",
      "partnerLabel": "Presented by {{partner}}",
      "opensInBrowser": "Opens in an in-app browser",
      "loading": "Opening partner site",
      "error": "Unable to open the partner site. Please try again."
    },
    "settings": {
      "sectionTitle": "Shopping and partners",
      "disclosure": "When affiliate suggestions are on, tapping one opens a partner site and tells that partner the visit came from CoutureCast. CoutureCast may earn a commission. No wardrobe photos or personal details are shared.",
      "optOutLabel": "Show \"Shop this look\" suggestions",
      "optOutHelp": "Turn this off to hide all partner and affiliate suggestions.",
      "saved": "Shopping preferences updated",
      "error": "Unable to update shopping preferences."
    }
  }
}
```

`opensInBrowser` renders visibly beneath the CTA **and** participates in the
accessible name, composed in the order: `cta`, `partnerLabel`, `opensInBrowser`.
`loading` replaces the CTA label during the pending state.

**Nothing audits a new key tree by default.** All four existing parity specs are
subtree-scoped and hard-coded:
`apps/web/src/i18n/wardrobe-capsules-locales.spec.ts:51-54`,
`apps/web/src/i18n/wardrobe-onboarding-locales.spec.ts:41-47`,
`apps/mobile/src/i18n/wardrobe-capsules-locales.spec.ts:57` (line 87 asserts an
exact key count), and
`apps/mobile/src/i18n/wardrobe-onboarding-silhouette-locales.spec.ts:55`. There
is no global checker. Add `apps/web/src/i18n/commerce-locales.spec.ts` and
`apps/mobile/src/i18n/commerce-locales.spec.ts`, copying the existing harness as
those files copy each other.

Two traps. The untranslated-value rule (web spec lines 122-137, mobile 126-138)
fails any non-English value equal to its English source unless listed in that
spec's own `APPROVED_COGNATES` map; "Shop this look" and the partner name are
likely collisions. And `apps/web/src/i18n/locales/en-US.json` currently has
exactly one top-level key (`wardrobe`), so `commerce` is the first sibling
namespace on web.

**Translation review.** The disclosure strings are compliance copy. PRD Success
Criteria require human review before release. The implementer produces the nine
non-English disclosure and settings-disclosure values as **draft**, marks them in
the PR description, and the story does not close until a reviewer signs off.
Machine-translating a paid-partnership disclosure and shipping it silently is
not acceptable.

### 17. Accessibility

- CTA and both toggles are at least 44 by 44 device-independent pixels.
- The CTA's accessible name is the composition in decision 16; the disclosure is
  a sibling text node in reading order before the control and is never hidden
  from assistive technology.
- Pending state sets `accessibilityState={{ busy: true }}` and blocks
  re-activation; the failure message uses `accessibilityRole="alert"` with
  `accessibilityLiveRegion="assertive"`, matching the existing settings screen.
- The Web toggle is a native `input[type="checkbox"]` with a real `<label>`, the
  gold focus ring, and a `role="status"` confirmation.
- Contrast meets WCAG 2.2 AA in the Web dark surface and the Mobile hero
  palette.

**The Web settings replacement must preserve an existing gate.**
`playwright/tests/accessibility-hardening.spec.ts:6` includes `/settings` in
`primaryRoutes` and runs, per route per viewport (1440×900 and 375×812, lines
13-16): `expectSkipContract` (lines 88-99, asserting exactly one
`main#main-content` with `tabindex="-1"` and a first focusable element named
"Skip to main content") then a full axe WCAG2A/2AA scan. The stub satisfies this
through `mobile-destination-page.tsx:5-9`. The replacement must keep all four of
`<main id="main-content">`, `tabIndex={-1}`, `data-focus-surface="dark"` (which
drives `--focus-essential` in `apps/web/src/app/globals.css:21-27`), and
`<StickyBottomNav />`. That suite loads `/settings` **unauthenticated**, so the
page must render cleanly with no session.

**Web auth.** Use `createWebApiClient` plus the `sessionStorage` bearer token at
`WEB_ACCESS_TOKEN_STORAGE_KEY`, matching `apps/web/src/lib/wardrobe.ts:31,67-73`
(three sibling libs use `credentials: 'include'` instead; wardrobe is the
convention to follow here). Signed out, the commerce section renders its
heading and disclosure with the toggle disabled and a localized "Sign in to
change this" hint, so the axe scan passes with no session.

---

## Acceptance criteria

### AC 1: A disclosed CTA renders only on eligible cards, bound to one partner

- **Given** an authenticated, audience-eligible user on Mobile with
  `commerce_affiliate_enabled` on, commerce preferences enabled, and a ritual
  scenario whose garment slots match exactly one active in-window offer for the
  resolved `locale_region`,
- **When** the outfit recommendation card renders from a network response,
- **Then** `shopThisLook` is non-null and carries one `partnerId`,
  `partnerDisplayName`, `offerId`, `offerTitle`, and `garmentCategory` and no
  URL; the card shows the localized disclosure, the partner label, and the CTA,
  with the disclosure in reading order before the control; and exactly one
  `affiliate_cta_shown` is emitted per `recommendation_id`, including across a
  scenario toggle away and back.
- **And** selection is deterministic: repeated requests for the same outfit
  return the same `offerId`, with exact `comfort_range` beating a wildcard row
  regardless of `priority`, and `id ASC` breaking any remaining tie.
- **And** a `default-{category}` placeholder slot matches only wildcard
  (`comfort_range IS NULL`) offers; a garment with a null category contributes
  no slot.
- **And** when any eligibility condition fails in the decision-4 order,
  `shopThisLook` is `null`, no CTA renders, and no impression is emitted.
- **And** a cache-served ritual payload never renders a CTA, and `shopThisLook`
  is stripped before `saveRitualCache`.

### AC 2: Clicks are attributed exactly once; conversions record idempotently

- **Given** an eligible card and an authenticated user,
- **When** the user activates the CTA, activates it twice within 60 seconds, or
  a partner posts a signed conversion for the resulting token,
- **Then** the first activation creates exactly one `AffiliateClick`, returns
  `201` with an `https` `redirectUrl` whose hostname equals or is a dot-suffix
  of the partner's `allowed_host` and whose `{clickToken}` placeholder is
  replaced by the HMAC token (not the row id), and emits exactly one
  `affiliate_cta_clicked`; the second activation returns `200` with the same
  `redirectUrl`, creates no row, and emits nothing; and the webhook creates one
  `AffiliateConversion` linked to the click and emits one
  `affiliate_conversion_recorded` with `matched: true`.
- **And** both dedupe boundaries hold: an activation at 59 seconds dedupes, one
  at 60.000 seconds mints fresh; and two concurrent activations on separate
  connections produce exactly one row.
- **And** the status code distinction between `201` and `200` is asserted over
  real HTTP through a Nest `TestingModule` with `supertest`, not through a spy
  on a mock response object.
- **And** a replayed `eventId` returns `200` writing nothing and emitting
  nothing; an unknown token persists an unmatched row with
  `affiliate_click_id = null`, returns `200`, and emits with `matched: false`;
  a missing or non-integer header, an unknown or inactive partner, an
  unresolvable or too-short secret, a timestamp outside ±300 seconds, and a bad
  signature each return `401` with the identical message and create no
  `AffiliateClick` and no `AffiliateConversion`; and a malformed body after a
  valid signature returns `400`.
- **And** a body that verifies still verifies when its JSON key order or
  insignificant whitespace differs from a re-serialized form, proven against a
  `TestingModule` created with `rawBody: true`.
- **And** the webhook route is reachable with no `Authorization` header, and a
  rejected webhook writes no `api_error_occurred` telemetry row.

### AC 3: The opt-out is server-enforced, immediate, and discloses the integration

- **Given** an authenticated user on Mobile settings or the Web settings page,
- **When** the user reads the section and turns off "Show 'Shop this look'
  suggestions",
- **Then** the section displays the localized third-party disclosure above the
  toggle; `affiliate_ctas_enabled` becomes `false` in the same transaction as an
  `AuditLog` row of type `commerce_affiliate_opt_out_changed`; the next
  `GET /api/v1/ritual` returns `shopThisLook: null` for every scenario even
  while a cached recommendation is served; `POST /api/v1/commerce/affiliate/clicks`
  returns `403` with the opted-out message; and the CTA disappears from the
  Mobile card without a sign-out, including when the device cache would
  otherwise serve a payload that had one.
- **And** turning it back on restores the CTA under the same rules; a user with
  no preference row is treated as enabled; an unchanged `PUT` returns `200` with
  the current state and writes no audit row; and the preferences endpoints
  remain available while `commerce_affiliate_enabled` is off.

### AC 4: Commercial records survive telemetry retention, and privacy holds

- **Given** click, conversion, and telemetry rows older than 24 hours,
- **When** `pruneOldTelemetryEvents` runs,
- **Then** `AffiliateClick` and `AffiliateConversion` are untouched while
  `TelemetryEvent` rows are pruned; and the commerce pruner removes commerce
  rows only past 24 months.
- **And** deleting a `User` cascades their `AffiliateClick` rows while
  `AffiliateConversion.affiliate_click_id` is set null, preserving the financial
  fact without the personal link.
- **And** neither server-emitted event carries a raw `user_id`, a URL, a product
  title, a garment id, or free text; both set `$ip: null` and persist with
  `user_id: null`; `affiliate_cta_shown` writes no `TelemetryEvent` row at all;
  and allowlist negative fixtures reject every disallowed field.

### AC 5: Commerce data respects RLS and role boundaries

- **Given** an owner, read-only guardian, full-access guardian, admin, revoked
  guardian, pending guardian, unverified email claim, spoofed `user_metadata`,
  unrelated authenticated user, anonymous role, and service role,
- **When** each actor reads, inserts, updates, or deletes `CommercePreference`
  and `AffiliateClick` directly,
- **Then** only the owner, admin actor, and service role succeed, **both
  guardian levels are denied**, and every other actor is denied; the two tables
  expose exactly the four `*_own_user_data` policy names; and
  `CommercePartner`, `AffiliateOffer`, and `AffiliateConversion` are unreachable
  by the `authenticated` role.

### AC 6: The feature degrades safely and bad catalog data cannot redirect

- **Given** `commerce_affiliate_enabled` resolving false, or PostHog unavailable
  with a `false` cached fallback,
- **When** any surface is exercised,
- **Then** `shopThisLook` is `null` everywhere, the click endpoint returns `503`
  ahead of every other check, the preferences endpoints and settings section
  still work, **the webhook still records conversions**, and the core ritual
  response is unchanged and still succeeds.
- **And** an offer whose resolved URL fails to parse, is not `https`, carries a
  userinfo component, has a hostname that is neither `allowed_host` nor a
  dot-suffix of it, or whose template lacks `{clickToken}`, returns `500`
  without redirecting and without creating a click row.

### AC 7: The experience is accessible and localized

- **Given** any of the ten locales and keyboard, screen-reader, touch, or switch
  input,
- **When** a user encounters the CTA on Mobile or the settings section on Mobile
  and Web,
- **Then** translated copy, disclosure placement, accessible-name composition,
  busy and error states, target sizes, focus behaviour, and contrast satisfy
  decisions 15 to 17; the ten-locale parity specs pass on both surfaces; the
  Mobile settings screen passes its existing all-locales overflow assertion; and
  the Web `/settings` route passes `expectSkipContract` and axe at both
  viewports, signed out.

---

## Tasks and subtasks

- [x] Task 1: Prisma schema, migration, RLS, and reachable seed (AC: 1 to 6)
  - [x] Add the three enums and five models from decision 10 to
        `packages/db/prisma/schema.prisma`, with the `User` back-relations, the
        offer lookup index, the partial unique dedupe index, both cascade rules,
        and all four check constraints including the `webhook_secret_ref`
        pattern.
  - [x] Generate the migration. Apply `private.can_manage_self_row` policies to
        `CommercePreference` and `AffiliateClick` using exactly the four
        `authenticated_read|insert|update|delete_own_user_data` names; enable
        RLS with no `authenticated` grant on the three catalog and conversion
        tables, modelled on `rls-policies.spec.ts:631`.
  - [x] Add `CommercePreference` and `AffiliateClick` to the `selfOnlyTables`
        array at `packages/db/test/rls-policies.spec.ts:10-31` and extend the
        actor matrix per AC 5, asserting guardians are denied.
  - [x] Add `packages/db/test/commerce-schema.spec.ts` proving defaults,
        cascades, `SetNull`, both unique constraints, the partial unique index,
        every check constraint, the offer lookup index, policies, and grants.
  - [x] Add `packages/db/prisma/seeds/commerce.ts` per decision 14 and wire it
        into `seeds/index.ts`; seed `commerce_affiliate_enabled: true` in
        non-production through `seeds/feature-flags.ts`. Guard both with
        `allowsTestOnlySecrets()`.
  - [x] Add `test:coverage` to `packages/db/package.json` so
        `scripts/run-workspace-test-coverage.mjs` (lines 29-35) picks the
        workspace up and these suites actually run on a PR.

- [x] Task 2: Contracts, analytics registries, fixtures, factories (AC: 1 to 6)
  - [x] Create `packages/api-client/src/contracts/http/commerce.ts` with
        `shopThisLookSchema`, `affiliateSurfaceSchema`, the preferences pair, the
        click request and response, the webhook payload and header schemas, and
        the six exported message constants from decision 9. Export from
        `contracts/http/index.ts`.
  - [x] Add `shopThisLook: shopThisLookSchema.nullable()` to
        `scenarioOutfitSchema`, with an `.openapi()` description stating the key
        is always present and `null` means not eligible.
  - [x] Extend the hand-maintained re-export block at
        `apps/api/src/contracts/http.ts:7-105`.
  - [x] Register every operation, header, status, and error in `openapi.ts` via
        `registerCommerceContracts`; bump `info.version` to `1.1.0`.
  - [x] Add the three event names to `analyticsEventNameSchema`,
        `analyticsEventSchemas` (`analytics-events.ts:407-433`), and
        `analyticsPropertySchemas`
        (`src/testing/analytics-event-assertions.ts:40`), plus strict property
        allowlists, `track*` wrappers, and negative fixtures rejecting URLs,
        titles, garment ids, and raw user ids.
  - [x] Add commerce fixtures and
        `packages/testing/src/factories/commerce.factory.ts`; extend
        `factories/registry.ts:1-16` and `cleanup.ts:15-40`. The three
        non-user-scoped tables cannot use `buildUserFilter` (`cleanup.ts:118-124`)
        — reuse the `cleanupScopeStartedAt` anchor (`cleanup.ts:53-64`) as
        `AlertCooldownReservation` does. Delete order: conversions → clicks →
        offers → partners → users.
  - [x] Run `npm run generate:api-client` and `npm run optic:lint`; commit the
        generated diff with no hand edits.

- [x] Task 3: Commerce module, preferences, eligibility (AC: 1, 3, 4, 6)
  - [x] Create `apps/api/src/modules/commerce/` with `commerce.module.ts`,
        `commerce-cache-headers.middleware.ts`,
        `commerce-preferences.controller.ts`, `commerce-preferences.service.ts`,
        `commerce.repository.ts`, `affiliate-offer.service.ts`, and
        `commerce-retention.service.ts`. Apply the middleware over
        `/api/v1/commerce{/*path}` in `configure(...)`. Use `.js` on relative
        imports, matching the surrounding `src/modules/` convention.
  - [x] Register `CommerceModule` in `app.module.ts` and import it from
        `personalization.module.ts` (never the reverse). `CommerceModule`
        imports `FeatureFlagsModule`, `TelemetryModule`, and `AuthStateModule`;
        `PersonalizationModule` currently imports none of them.
  - [x] Implement `isAffiliateAudienceEligible(profile)` as a stub that always
        returns `true`, with Decision 1's resolution (2026-08-11, no
        age-based suppression) recorded in its doc comment, plus the
        reversal steps. Do **not** call it from decision 4's eligibility
        chain. Do not export `hasReachedAgeOfMajority` for this purpose --
        it is unused unless the policy reverses.
  - [x] Implement `GET` and `PUT /api/v1/commerce/preferences`, ungated by the
        flag, with the audit row in the same transaction and no row on an
        unchanged value.
  - [x] Implement `AffiliateOfferService.resolveShopThisLook(...)` with the
        decision-4 short-circuit order, both slot derivations, the single-offer
        `ORDER BY`, database-clock window boundaries, and `locale_region`
        resolution including the `'*'` sentinel.
  - [x] Assemble the block in `RitualController.getOrCreateRitual` between the
        service call and `ritualResponseSchema.parse` at line 55. Do not touch
        `RitualService`'s constructor.
  - [x] Implement the monthly 24-month commerce pruner.
  - [x] Unit tests: every short-circuit, both slot derivations, exact-beats-
        wildcard, priority, `id ASC` tie-break, both window boundaries, region
        resolution for `en-US` / `fr-CA` / `es-419` / no-locale, a null-category
        garment, and a no-match outfit. Assert no cache write contains a
        `shopThisLook` key.

- [x] Task 4: Attributed click endpoint (AC: 2, 3, 6)
  - [x] Add `affiliate-click.controller.ts` and `affiliate-click.service.ts`
        under `RequestAuthGuard`. Re-verify eligibility conditions 1 to 3 plus
        offer active-and-in-window; do not re-derive the outfit, since the
        recommendation may have rotated behind the cache.
  - [x] Implement token minting (HMAC over the row id keyed by
        `COMMERCE_CLICK_TOKEN_SECRET`, resolved through the
        `requireUploadTokenSecret` shape), the 60-second dedupe with the partial
        unique index and conflict-retry, and `201` versus `200`.
  - [x] Implement URL construction and the full host validation from decision 7.
  - [x] Implement the decision-9 status precedence and use the exported message
        constants.
  - [x] Emit `affiliate_cta_clicked` after commit, fail-open.
  - [x] Add `apps/api/integration/commerce-affiliate-clicks.integration.spec.ts`
        covering both dedupe boundaries, two concurrent activations on separate
        connections yielding one row, every error path, and a `supertest`
        assertion of `201` versus `200` over real HTTP.
  - [x] Add unit tests for every error branch, because the integration suite
        does not run in CI (Task 10).

- [x] Task 5: Conversion webhook (AC: 2, 4, 6)
  - [x] Set `rawBody: true` in **all three** bootstraps: `apps/api/src/main.ts:55`,
        `apps/api/api/index.ts:12-14`, and the webhook spec's
        `createNestApplication({ rawBody: true })`. Confirm no existing route
        regresses, and note in the PR whether the `api/index.ts` bootstrap's
        missing `ApiExceptionFilter`/CORS/request-context wiring affects any AC.
  - [x] Add `affiliate-webhook.controller.ts` and `affiliate-webhook.service.ts`
        with no `@UseGuards`. Assert by supertest that the route is reachable
        with no `Authorization` header.
  - [x] Implement the five-step verification in order, reusing the
        `wardrobe-upload-token.ts:8-46` structure, with the constrained
        `webhook_secret_ref` resolution and one identical `401` message.
  - [x] Implement append-only persistence: `(partner_id, external_event_id)`
        idempotency, unmatched-token rows, always `200`, no kill switch.
  - [x] Emit `affiliate_conversion_recorded` once per newly persisted row, with
        the matched and unmatched subject rules.
  - [x] Generalize `TelemetryService` per decision 12 (set plus builder table,
        export `buildAnalyticsSubjectId`) and exclude the webhook route from
        `api_error_occurred` in `ApiExceptionFilter`.
  - [x] Add `apps/api/integration/commerce-affiliate-webhook.integration.spec.ts`
        covering the full signature matrix, both timestamp edges, replay,
        unknown token, missing and malformed headers, an unresolvable secret,
        the raw-body reordered-keys proof, and that conversions still record
        with the flag off.
  - [x] Add the retention regression test: `pruneOldTelemetryEvents` leaves aged
        commerce rows intact; the commerce pruner removes them past 24 months.

- [x] Task 6: Mobile CTA and settings (AC: 1 to 3, 6, 7)
  - [x] Extend `apps/mobile/components/hero/outfit-recommendation-card.tsx` with
        a block rendering disclosure, partner label, CTA, and the visible
        `opensInBrowser` line, shown only when `outfit.shopThisLook` is non-null
        **and** the payload came from the network. Preserve the skeleton branch
        (29-41), the `if (!outfit) return null` guard (43-45), badge state, and
        `onGarmentRef`.
  - [x] Add `apps/mobile/src/lib/commerce.ts` on `@couture/api-client/contracts/http`
        wrappers. Add the click call, the pending state, the
        `WebBrowser.openBrowserAsync` handoff following
        `components/external-link.tsx:20-27`, and the localized failure that does
        not navigate.
  - [x] Strip `shopThisLook` before `saveRitualCache` at
        `apps/mobile/app/(tabs)/index.tsx:216-220`, and ensure the cache-read
        paths (196-206, 243-246) never render a CTA.
  - [x] Emit `affiliate_cta_shown` once per `recommendation_id` using a `useRef`
        guard, following the precedent at `index.tsx:141,261-268`. The effect
        re-runs on `activeLocale` and `analyticsUserId` change, so the guard must
        key on `recommendation_id`, not on mount. There is no StrictMode in this
        app; do not add a guard for it.
  - [x] Add the "Shopping and partners" section with disclosure and switch to
        `apps/mobile/app/(tabs)/settings.tsx`, preserving the existing locale
        flow, `localeChangeInFlight` guard, persistence, and alert semantics.
  - [x] Add the `commerce.*` tree to all ten catalogs plus
        `apps/mobile/src/i18n/commerce-locales.spec.ts`, handling
        `APPROVED_COGNATES` collisions.
  - [x] Tests live under `apps/mobile/src/screens/` and
        `apps/mobile/components/`; `app/**` is not in
        `apps/mobile/vitest.config.ts:141`. Follow the
        `tab-two-screen.test.tsx:45` precedent of importing
        `'../../app/(tabs)/settings'`. Cover the eligible render, the null
        render, the cache-served no-CTA case, pending, failure-without-navigation,
        double-tap, once-per-`recommendation_id`, the toggle round-trip, and the
        CTA disappearing after opt-out. Extend the all-locales overflow assertion
        at `tab-two-screen.test.tsx:248-282` to the new section.
  - [x] Extend `apps/mobile/src/test-utils/msw/handlers.ts:239-274` and
        `mockRitualResponse` (line 23) with `shopThisLook`, or no render test can
        pass.

- [x] Task 7: Web settings surface (AC: 3, 7)
  - [x] Replace the `apps/web/src/app/settings/page.tsx` stub with a real page
        preserving `<main id="main-content">`, `tabIndex={-1}`,
        `data-focus-surface="dark"`, and `<StickyBottomNav />`. It must render
        cleanly signed out.
  - [x] Add `apps/web/src/lib/commerce.ts` using `createWebApiClient` and the
        `sessionStorage` bearer token, mirroring `apps/web/src/lib/wardrobe.ts`.
  - [x] Implement the disclosure paragraph plus a native labeled checkbox with
        the gold focus ring, `role="status"` confirmation, error path, optimistic
        update that reverts on failure, and the signed-out disabled state.
  - [x] Add the `commerce.*` tree to all ten catalogs plus
        `apps/web/src/i18n/commerce-locales.spec.ts`. `commerce` is the first
        sibling of `wardrobe` in `en-US.json`.
  - [x] Add handlers to `apps/web/src/test-utils/msw/handlers.ts` or inject via
        `useMswHandlers`; `apps/web/vitest.setup.ts:15-22` throws on any
        unhandled `/api/` request.
  - [x] Component and integration tests for load, toggle on, toggle off, server
        error recovery, signed-out state, and request-shape assertions.

- [ ] Task 8: Consumer and provider contracts (AC: 1 to 6)
  - [ ] Add `packages/api-client/testing/commerce-contract.spec.ts` (flat, in
        `testing/`; there is no `__tests__` directory in this package) covering
        the eligible and null `shopThisLook` shapes, both preference operations,
        the click request and both success codes, and every webhook status.
  - [ ] Prove registry coverage via `npm run optic:lint` and
        `npm run build:packages`.
  - [ ] Add Pact interactions across all five required files:
        `pact/http/consumer/api-contract-interactions.ts`,
        `pact/http/consumer/web-api-client.pacttest.ts`,
        `pact/http/consumer/mobile-api-client.pacttest.ts`, the `stateHandlers`
        map in `pact/http/provider/state-handlers.ts:38`, and a scenario branch
        in `pact/http/provider/provider-helper.ts`. Follow the
        `createProviderState({ name, params })` convention at
        `api-contract-interactions.ts:986-1000`.
  - [ ] Provider states: eligible user, opted-out user, audience-ineligible
        user, flag-disabled environment, unknown offer, invalid signature.
  - [ ] One interaction per test; preserve the single-fork FFI config; pass the
        three-run `test:pact:consumer` determinism gate.

- [ ] Task 9: End-to-end, accessibility, and performance (AC: 1 to 7)
  - [ ] Add `playwright/tests/commerce-affiliate-preferences.spec.ts`: load Web
        settings, assert the disclosure renders, toggle off, assert the round
        trip and persistence after reload, toggle back on, axe pass,
        keyboard-only operation with a visible focus ring.
  - [ ] Add `playwright/tests/api/commerce-affiliate.api.spec.ts` against the
        **seeded** catalog and flag from decision 14 with public-API user setup:
        the eligible `shopThisLook` shape, `null` when opted out, `null` when
        audience-ineligible, the click round-trip and `redirectUrl` host, the
        double-tap dedupe, and the webhook signature matrix.
  - [ ] Add `maestro/commerce-affiliate.yaml` plus
        `test:mobile:e2e:commerce:{ios,android}` scripts.
        `scripts/run-maestro.mjs:56` defaults to `sanity.yaml` and
        `analytics.yaml` when no path is passed, so `test:mobile:e2e:ios` would
        never run a new flow. Assert on visible text, following
        `maestro/hero-experience.yaml:27-29`.
  - [ ] Record VoiceOver and TalkBack evidence for the CTA and both toggles.
        `epics.md` assigns recurring manual screen-reader runs to CC-3.8; this
        is a one-time check of the new controls only, not a release sweep.
  - [ ] Add an **absolute** ritual SLO for the eligible path as a new key in
        both branches of `k6/helpers/config.ts:9-45` plus a threshold entry and a
        `scenarioNames` entry in `k6/tests/couture-api-baseline.k6test.ts:26-37`.
        The harness has no baseline-diff facility, so an earlier "adds no more
        than 50 ms" budget was unmeasurable; state an absolute P95 instead.
  - [ ] Add a query-plan assertion for the offer lookup following
        `apps/api/integration/wardrobe-capsules-query-plan.integration.spec.ts:69,88`
        (`EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)`), and record it in the release
        QA artifact.

- [ ] Task 10: Verification gate (AC: 1 to 7)
  - [ ] Run `npm run db:generate`, `npm run db:migrate`,
        `npm run generate:api-client`, `npm run optic:lint`; confirm the
        generated diff is intentional with no hand edits.
  - [ ] Run the `@couture/db`, `@couture/config`, `@couture/testing`,
        `@couture/api-client`, `api`, `web`, and `mobile` suites, Pact, locale
        parity, Playwright, Maestro, k6, and the query-plan check.
  - [ ] Meet the coverage ratchets, which **do** gate CI
        (`.github/workflows/pr-checks.yml:70`): api `{94, 88, 95, 94}`
        (`apps/api/vitest.config.ts:28`), web `{94, 88, 93, 94}`, mobile
        `{90, 85, 90, 92}`. Nine new API source files are in scope, so every
        error branch needs unit coverage.
  - [ ] Note the CI gaps rather than assuming coverage:
        `packages/db/test/**` only runs on a PR after Task 1 adds
        `test:coverage`; no workflow runs `test:integration`, so Tasks 4 and 5
        evidence is local-only; `.github/workflows/pr-mobile-e2e.yml:7` is
        `workflow_dispatch` only, so Maestro never runs on a PR. Either add an
        integration job or state plainly in the PR that this evidence is
        one-time and unprotected after merge.
  - [ ] Run `npm run verify:changed`, then `npm run validate`. Note that
        `scripts/verify-changed.mjs:65-81` maps only `packages/` and `apps/`
        paths, so `playwright/`, `pact/`, `k6/`, `maestro/`, and `scripts/`
        changes need their own explicit runs.
  - [ ] Confirm zero lint, typecheck, test, build, accessibility, generated
        artifact, contract, determinism, performance, retry-masked, focused, or
        quarantined-test failures.
  - [ ] Record in `deferred-work.md`: the Web `Sponsored` disclosure copy defect,
        the missing partner admin console, the missing weekly link-validation job
        and neutral-card fallback, the outfit-detail-view CTA surface, the
        `locale_region`-is-not-a-jurisdiction limitation, the per-item offer
        narrowing, and the opt-out-versus-opt-in tension.

---

## Dev notes

### State of the code this story builds on

1. **`apps/api/src/modules/personalization/ritual.service.ts`** — computes
   `requiredCategories`, `targetComfortRange`, and `genericGarmentIds`, falling
   back to `default-{category}`. Caches in Redis and `OutfitRecommendation`.
   **Preserve:** the three-scenario invariant, the CC-4.3 capsule selection path,
   cache revision validation, the `first_outfit_generated` hook, and the
   constructor signature (twelve positional `new RitualService(...)` sites in
   its spec). **Change:** nothing. The commerce block goes in the controller.

2. **`apps/api/src/modules/personalization/ritual.controller.ts:46-55`** — the
   single assembly point. **Change:** insert the commerce step before
   `ritualResponseSchema.parse` at line 55. `ritual.controller.spec.ts:232`
   registers the real `RitualService` in a `TestingModule`, so a new injected
   provider must be registered there too.

3. **`apps/mobile/components/hero/outfit-recommendation-card.tsx`** — its
   `outfit` prop is the zod-inferred `ScenarioOutfit` imported from
   `@couture/api-client/contracts/http` (line 4), so an additive optional field
   flows through with no client type work. **Preserve:** skeleton (29-41), null
   guard (43-45), badge expand state, garment ref callbacks.

4. **`apps/mobile/app/(tabs)/index.tsx`** — device ritual cache at 196-206,
   216-220, 243-246 (decision 6); `useRef` once-only precedent at 141, 261-268.

5. **`apps/mobile/app/(tabs)/settings.tsx`** — locale switching with an
   in-flight ref guard, persistence, offline retry on mount, and an
   `accessibilityRole="alert"` line. **Preserve all of it**; add a sibling
   section.

6. **`apps/api/src/modules/telemetry/telemetry.service.ts`** — `captureEvent`
   validates, persists without awaiting, forwards to PostHog, awaits the DB
   promise last so neither sink breaks the other. The pseudonymous branch is
   hard-coded to two event names (396-407) and `buildAnalyticsSubjectId` (154)
   is module-private. **Preserve:** fail-open on both sinks. **Change:**
   generalize per decision 12.

7. **`packages/api-client/src/contracts/http/common.ts:24-78`** — `.strict()`
   error envelopes with no `code` field. This is why decision 9 exists.

8. **`apps/web/src/app/settings/page.tsx`** — a five-line stub whose
   accessibility contract is load-bearing (decision 17).

### Architectural constraints

1. **Strict TypeScript and Zod.** Preserve `strict`,
   `noUncheckedIndexedAccess`, `useUnknownInCatchVariables`, `isolatedModules`.
   No `any`, no `as unknown as T`. Parse every boundary with canonical schemas;
   types are not a trust boundary. Narrow caught `unknown` before use.

2. **NestJS.** Feature-first under `src/modules/commerce`. Transport in
   controllers, rules in services, persistence in the repository, providers via
   the module with constructor injection. `.js` on relative imports is the
   convention inside `src/modules/`, not repo-wide (`app.module.ts:3-24` omits
   it on 20 of 22 imports); follow the surrounding module convention. Note
   `PrismaModule` is `@Global()` (`prisma.module.ts:6`).

3. **Prisma and RLS.** Edit the schema, generate a migration, run the repo
   script. Never hand-edit generated client output or migration history.

4. **Contracts.** Shared Zod modules are the only source of truth; controllers,
   OpenAPI JSON, docs, and the SDK are downstream. New endpoints start in the
   contract module. Web and Mobile consume
   `@couture/api-client/contracts/http` only.

5. **Secrets.** Partner secrets live in env vars named by the constrained
   pattern in decision 10 and are never stored, logged, fixtured, or committed.
   Add placeholders to `.env.example` following the
   `WARDROBE_UPLOAD_TOKEN_SECRET` convention and document them in
   `secrets-management.md`. Never log JWTs, signatures, raw bodies, click
   tokens, or secrets.

6. **Testing.** Pure logic in table-driven Vitest; authorization, transactions,
   idempotency, concurrency, and RLS in real-PostgreSQL integration tests with
   separate connections and deterministic barriers. `@couture/testing` factories
   everywhere they fit, namespaced synthetic data, reverse-order cleanup
   registered with `onTestFinished` **before** the assertions so a real failure
   cannot manufacture a second one in a sibling test. Pact covers request and
   response understanding, statuses, headers, and error shapes only. Playwright
   uses semantic roles, merged-fixture API setup, network-first sync, web-first
   assertions, and public-API cleanup. No hard waits, no shared state, no
   `.only`. Note `apps/api/vitest.config.ts:16` already includes
   `integration/**/*.spec.ts` in `test`, so `test:integration` is a strict
   subset and `npm run test --workspace api` needs live PostgreSQL and Redis.

7. **Idempotency.** Jobs, webhooks, analytics, and test setup are idempotent.
   Retries must not duplicate a click, a conversion, a notification, or an audit
   record.

### Lessons carried forward from Story 4.4's review

- **HTTP-visible behavior needs an assertion that goes over HTTP.** 4.4 shipped
  a `201`-versus-`200` fix whose unit test spied on a hand-built mock `res` and
  whose integration test called the service directly; both stayed green when the
  controller was reverted. This story has the same `201`/`200` distinction on the
  click endpoint and a status matrix on the webhook. Each needs a real
  `TestingModule` plus `supertest`.
- **A response's cache identity must cover everything that changes the body.**
  4.4 shipped a transition that changed a body without changing what clients
  cached on. The analogue here is the ritual cache, which is why decision 5
  keeps the commerce block outside it and decision 6 strips it from the device
  cache.
- **Cleanup of shared external state must run even when assertions throw.**
  Register with `onTestFinished` before the assertions.

### The failure modes most likely to sink this story

1. **Setting `rawBody: true` only in `src/main.ts`.** Preview and production run
   `api/index.ts`, and the tests run their own bootstrap. Signature
   verification then works locally and nowhere else, and the proof test passes
   for the wrong reason.
2. **Enforcing the opt-out only on the server.** The mobile device cache serves
   a stale payload for fifteen minutes online and forever offline.
3. **Inventing a `code` field on the error envelope.** The shared schemas are
   `.strict()`; it will fail contract tests, and the ACs are written against
   status plus message for that reason.
4. **Putting the commerce block inside `RitualService`.** There is no single
   post-cache point, `targetComfortRange` is out of scope on the warm path, and
   the constructor has twelve positional call sites.
5. **Non-deterministic offer selection.** Without the full
   `(comfort_range IS NULL) ASC, priority DESC, id ASC` ordering, attribution
   comparisons and every E2E assertion become flaky.
6. **Letting the affiliate tables inherit telemetry retention.** They sit beside
   `TelemetryEvent` and the hourly pruner is one line from deleting commercial
   records.

### Verification commands

```bash
npm run db:generate
npm run db:migrate
npm run generate:api-client
npm run optic:lint
npm run test --workspace @couture/db
npm run test --workspace @couture/config
npm run test --workspace @couture/testing
npm run test --workspace @couture/api-client
npm run test --workspace api          # includes integration/; needs PostgreSQL + Redis
npm run test --workspace web
npm run test --workspace mobile
npm run test:pact
npm run test:pw-local -- commerce-affiliate
npm run test:pw:burn-in-changed
npm run test:mobile:e2e:commerce:ios
npm run test:mobile:e2e:commerce:android
npm run test:k6:local
npm run verify:changed                # workspaces only; see Task 10
npm run validate
```

### Source tree files to create or modify

```text
packages/db/prisma/schema.prisma
packages/db/prisma/migrations/<timestamp>_add_commerce_affiliate/migration.sql
packages/db/prisma/seeds/commerce.ts
packages/db/prisma/seeds/index.ts
packages/db/prisma/seeds/feature-flags.ts
packages/db/package.json
packages/db/test/commerce-schema.spec.ts
packages/db/test/rls-policies.spec.ts
packages/config/src/flags.ts
packages/config/src/flags.spec.ts
packages/api-client/src/contracts/http/commerce.ts
packages/api-client/src/contracts/http/ritual.ts
packages/api-client/src/contracts/http/index.ts
packages/api-client/src/contracts/http/openapi.ts
packages/api-client/src/types/analytics-events.ts
packages/api-client/src/testing/analytics-event-assertions.ts
packages/api-client/src/testing/commerce-fixtures.ts
packages/api-client/testing/commerce-contract.spec.ts
packages/testing/src/factories/commerce.factory.ts
packages/testing/src/factories/index.ts
packages/testing/src/factories/registry.ts
packages/testing/src/cleanup.ts
apps/api/src/main.ts
apps/api/api/index.ts
apps/api/src/app.module.ts
apps/api/src/contracts/http.ts
apps/api/src/filters/api-exception.filter.ts
apps/api/src/modules/commerce/commerce.module.ts
apps/api/src/modules/commerce/commerce-cache-headers.middleware.ts
apps/api/src/modules/commerce/commerce-preferences.controller.ts
apps/api/src/modules/commerce/commerce-preferences.service.ts
apps/api/src/modules/commerce/commerce.repository.ts
apps/api/src/modules/commerce/affiliate-offer.service.ts
apps/api/src/modules/commerce/affiliate-click.controller.ts
apps/api/src/modules/commerce/affiliate-click.service.ts
apps/api/src/modules/commerce/affiliate-webhook.controller.ts
apps/api/src/modules/commerce/affiliate-webhook.service.ts
apps/api/src/modules/commerce/commerce-retention.service.ts
apps/api/src/modules/guardian/guardian.service.ts
apps/api/src/modules/personalization/personalization.module.ts
apps/api/src/modules/personalization/ritual.controller.ts
apps/api/src/modules/personalization/ritual.controller.spec.ts
apps/api/src/modules/telemetry/telemetry.service.ts
apps/api/integration/commerce-affiliate-clicks.integration.spec.ts
apps/api/integration/commerce-affiliate-webhook.integration.spec.ts
apps/mobile/components/hero/outfit-recommendation-card.tsx
apps/mobile/app/(tabs)/index.tsx
apps/mobile/app/(tabs)/settings.tsx
apps/mobile/src/lib/commerce.ts
apps/mobile/src/i18n/commerce-locales.spec.ts
apps/mobile/src/test-utils/msw/handlers.ts
apps/mobile/assets/locales/*.json
apps/web/src/app/settings/page.tsx
apps/web/src/lib/commerce.ts
apps/web/src/i18n/commerce-locales.spec.ts
apps/web/src/test-utils/msw/handlers.ts
apps/web/src/i18n/locales/*.json
playwright/tests/commerce-affiliate-preferences.spec.ts
playwright/tests/api/commerce-affiliate.api.spec.ts
pact/http/consumer/api-contract-interactions.ts
pact/http/consumer/web-api-client.pacttest.ts
pact/http/consumer/mobile-api-client.pacttest.ts
pact/http/provider/state-handlers.ts
pact/http/provider/provider-helper.ts
maestro/commerce-affiliate.yaml
k6/helpers/config.ts
k6/tests/couture-api-baseline.k6test.ts
package.json
.env.example
_bmad-output/project-knowledge/secrets-management.md
_bmad-output/implementation-artifacts/deferred-work.md
```

### References

- [Epic 5 CC-5.1](file:///Users/murat/opensource/couture-cast/_bmad-output/planning-artifacts/epics.md#L420)
- [PRD FR5 Commerce & Monetization](file:///Users/murat/opensource/couture-cast/_bmad-output/planning-artifacts/prd.md#L196)
- [PRD success criteria and disclosure guardrails](file:///Users/murat/opensource/couture-cast/_bmad-output/planning-artifacts/prd.md#L37)
- [Architecture, API contract ownership](file:///Users/murat/opensource/couture-cast/_bmad-output/planning-artifacts/architecture.md#L167)
- [Architecture, performance and caching](file:///Users/murat/opensource/couture-cast/_bmad-output/planning-artifacts/architecture.md#L199)
- [UX, sponsorship labels and Lookbook Card](file:///Users/murat/opensource/couture-cast/_bmad-output/planning-artifacts/ux-design-specification.md#L288)
- [Project context, critical rules](file:///Users/murat/opensource/couture-cast/_bmad-output/project-context.md)
- [Story 1.4 telemetry baseline](file:///Users/murat/opensource/couture-cast/_bmad-output/implementation-artifacts/1-4-telemetry-audit-baseline.md)
- [Story 2.1 scenario outfit generator](file:///Users/murat/opensource/couture-cast/_bmad-output/implementation-artifacts/2-1-scenario-outfit-generator.md)
- [Story 4.3 capsule builder, contract and RLS precedent](file:///Users/murat/opensource/couture-cast/_bmad-output/implementation-artifacts/4-3-outfit-capsule-builder.md)
- [Step 32 hard-won lessons](file:///Users/murat/opensource/couture-cast/_bmad-output/project-knowledge/learning-path-step-by-step.md#L3091)

## Dev agent record

### Agent model used

### Debug log references

### Completion notes list

### File list

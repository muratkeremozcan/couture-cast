# Story 6.15 Round 5 Review — `settleCapture` Seam & D15 RevenueCat Test Store

- **Worktree**: `/Users/murat/opensource/cc/couture-cast-wt-615` (`feat/story-6-15-expo-sdk-58`, `HEAD` `8d0bb7c4`)
- **Range**: `79874bcf..8d0bb7c4` (`54177794`, `a386c4d5`, `c3799201`, `5ae846af`, `8d0bb7c4`)
- **Scope**: `settleCapture` widening seam (`8d0bb7c4`), `@couture/api-client` `test_store` contract (`54177794`), Prisma `EntitlementStore` enum & migration (`a386c4d5`), `apps/api` `TEST_ENV` gating on webhook & REST pull (`c3799201`), `apps/mobile` `manageEntryFor` (`5ae846af`).

---

## Findings (Ranked P0–P3)

### P1 — Pre-existing `test_store` entitlement rows keep granting active Premium access and resist expiration/reconciliation if `TEST_ENV` changes away from `local`/`preview`

- **Locations**:
  - `apps/api/src/modules/commerce/premium-entitlement.service.ts:230-236` (`hasPaidAccess`)
  - `apps/api/src/modules/commerce/premium-entitlement.service.ts:178-193` (`getEntitlement`)
  - `apps/api/src/modules/commerce/stripe-billing.service.ts:85-88` (`createCheckoutSession`)
  - `apps/api/src/modules/commerce/billing-webhook.service.ts:291-293` (`planRevenueCatTransition`)
  - `apps/api/src/modules/commerce/revenuecat-client.ts:181-184,295-302` (`mapRevenueCatRestStore`, `projectSubscriber`)
  - `apps/api/src/modules/commerce/subscription.service.ts:103-112` (`pullAndApply`)
  - `apps/api/src/modules/commerce/billing-reconciliation.service.ts:187-202` (`correctDrift`)
- **Failure scenario**:
  `hasPaidAccess(userId)` queries only `select: { status: true }` and returns `row?.status === 'active' || row?.status === 'grace_period'` with no check on `row.store` (`premium-entitlement.service.ts:231-235`). `getEntitlement(userId)` likewise returns `{ status, store: row.store, ... }` unconditionally (`premium-entitlement.service.ts:178-193`).
  If any database holds an `active` or `grace_period` `premium_entitlement` row with `store = 'test_store'` and the API runs outside `TEST_ENV=local|preview` (for example, `TEST_ENV` was temporarily enabled during QA or misconfigured and then unset or set to `production`):
  1. **Unpaid Premium access persists**: `hasPremiumAccess`, `premiumAccessSource`, `GET /api/v1/commerce/premium/access`, and `GET /api/v1/commerce/subscription` all continue treating the user as an active paid subscriber in production.
  2. **Automatic expiration and reconciliation are locked out**: outside `local`/`preview`, a RevenueCat `TEST_STORE` `EXPIRATION` or `CANCELLATION` webhook is downgraded to `RECORD_ONLY` (`billing-webhook.service.ts:291-293`), `POST /api/v1/commerce/subscription/refresh` throws `RevenueCatUnsupportedStoreError` mapped to HTTP `503` (`revenuecat-client.ts:301` -> `subscription.service.ts:111`), and `BillingReconciliationService.correctDrift` logs `billing_reconciliation_drift_pull_failed` and leaves the `test_store` row active (`billing-reconciliation.service.ts:194-200`).
  3. **Side effects on users/clients**: `createCheckoutSession` blocks real Stripe purchase with `409 Conflict` (`stripe-billing.service.ts:86-88`), and installed `1.7.0` pre-D15 mobile/web clients whose `entitlementStoreSchema` omits `'test_store'` fail response schema parsing on `/api/v1/commerce/subscription`.
- **Remediation**: Fail closed when `!appliesRevenueCatTestStore()`: `hasPaidAccess` must exclude `store: 'test_store'` outside `local`/`preview`, and `getEntitlement` should treat an out-of-env `test_store` row as absent (or non-entitled) rather than serving `store: 'test_store'` and granting paid access.

### P2 — Null-`store` RevenueCat `TRANSFER` webhook can copy a pre-existing `test_store` row in production

- **Locations**:
  - `apps/api/src/modules/commerce/billing-webhook.service.ts:162,291-296,328-343,682,709-745`
- **Failure scenario**:
  `revenueCatEventSchema` accepts `store: z.string().nullish()` (`billing-webhook.service.ts:162`). In `planRevenueCatTransition`, the unsupported-store guard is `if (event.store && mapRevenueCatStore(event.store) === null) return RECORD_ONLY;` (`lines 291-293`), followed immediately by `if (event.type === 'TRANSFER') return { kind: 'transfer' }` (`lines 294-296`).
  If an authenticated RevenueCat `TRANSFER` webhook omits `store` or sends `store: null` outside `TEST_ENV=local|preview` for a `losingUserId` holding an existing `test_store` row, `event.store` is falsy so the guard at `line 291` is skipped. `applyTransfer` then revokes `losingUserId` and calls `resolveTransferGainState`, which falls back to `losingRow?.store` (`line 332`) and writes `status: 'active', store: 'test_store'` onto `gainingUserId` (`lines 732-742`) even in production (while recording `billingEvent.store = null` at `line 700`).
- **Remediation**: Reject or skip the gain write in `applyTransfer` / `resolveTransferGainState` whenever the resolved `store === 'test_store'` and `!appliesRevenueCatTestStore()` (and avoid revoking a non-production-honored `test_store` row as a transfer).

### P3 — Web subscription UI renders store-management hint for `test_store` while mobile hides it

- **Locations**:
  - `apps/web/src/app/components/subscription-section.tsx:171-199` (`ManageControls`)
  - Compare with `apps/mobile/src/lib/premium.ts:133-137` (`manageEntryFor`) and `apps/mobile/app/(tabs)/settings.tsx:894-914`
- **Failure scenario**:
  `5ae846af` updated `manageEntryFor` on mobile so `'promotional' || 'test_store'` yields `'none'`, hiding manage controls. On web (`subscription-section.tsx:181`), `ManageControls` checks only `if (store !== 'stripe')`, so a local/preview user with a `test_store` entitlement sees `commerce.premium.manageInStore` ("managed in the app store it was purchased from") even though RevenueCat Test Store purchases are not tied to an App Store or Play Store account. (Stripe Customer Portal remains protected server-side at `apps/api/src/modules/commerce/stripe-billing.service.ts:137-139`.)

---

## Detailed Checks & Verdicts

### 1. `settleCapture` seam (`8d0bb7c4`) & Mutant Verification

- **Closure assessment**: Clean. `settleCapture` (`scripts/lib/live-font-capture.mjs:598-627`) accepts injected `{ read, capture, mounts, stage, pause, now, deadlineError }`, invokes `mounts.captured(stage, flat.markers)` inside `nodes()` on every settle read (`line 612`), waits until layout stability for `stableMs`, and invokes `capture()`. `scripts/run-live-font-proof.mjs:373-381` delegates `settle()` directly to `settleCapture`.
- **Mutant check (stops widening)**: In a detached worktree at `8d0bb7c4` (`/tmp/wt-615-mutant-r5`, removed afterward), commenting out `mounts.captured(stage, flat.markers)` at `scripts/lib/live-font-capture.mjs:612` and running `node --test scripts/lib/live-font-*.test.mjs` **killed the mutant** (`MUTANT_EXIT=1`):
  - `✖ a scope only the first settle read showed is reread for by the capture` (`scripts/lib/live-font-capture.test.mjs:796`, assertion at `line 820`: `actual: ['root', 'settings']`, `expected: ['root', 'settings', 'home']`), 101 passed, 1 failed.

### 2. Replaced Assertion Audit: `U-C-SUBSCRIPTION-FROZEN` (`54177794`)

- **Locations**: `packages/api-client/testing/premium-access-contract.spec.ts:19-38,111-138`
- **Verdict**: **Does not loosen unrelated frozen assertions.** `withTestStore` only transforms nodes whose `enum` array JSON-equals `['app_store', 'play_store', 'stripe', 'promotional']` and appends `'test_store'`. It asserts `expect(expected.patched).toBe(2)` (matching the two `store` enums inside `Subscription` in `packages/api-client/testing/subscription-contract-1.7.0.baseline.json:61` and `152`), verifies the baseline schema key set is unchanged (`['Subscription', 'SubscriptionPlan', 'SubscriptionResponse', 'SubscriptionStatus']`), and asserts deep equality against all 4 schemas and `GET /api/v1/commerce/subscription` responses. Note that `EntitlementStore` was registered separately in `packages/api-client/src/contracts/http/subscription.ts:207` and is outside those 4 baseline schema names.

### 3. Production Gating, Webhooks & REST Pull (`c3799201`)

- **`TEST_ENV` gating (`apps/api/src/config/runtime-environment.ts:1-2,17-22`)**:
  `(env.TEST_ENV ?? '').trim().toLowerCase()` must strictly equal `'local'` or `'preview'`. `TEST_ENV` unset, `''`, `'staging'`, `'production'`, `'previewer'`, `NODE_ENV='test'`, and `VERCEL_ENV='preview'` all return `false`; mixed case/whitespace (`' Preview '`) trims/lowercases to `'preview'` and returns `true`.
- **Webhook forging / replay (`billing-webhook.service.ts:579-606`, `billing-webhook-secrets.ts:46-52`)**:
  `handleRevenueCatWebhook` validates `REVENUECAT_WEBHOOK_AUTH` (>= 32 chars; test-only secret fallback is active only when `allowsTestOnlySecrets()` is true, i.e., `NODE_ENV === 'test'` or `TEST_ENV=local`, never `preview` or `production`) using `timingSafeEqual` (`safeEquals`) _before_ `JSON.parse`, deduplicates replays via `findExistingEvent('revenuecat', event.id)` (`line 603`) and unique constraint `(provider, external_event_id)` (`lines 748,797-805`), and maps `TEST_STORE` to `null` / `RECORD_ONLY` outside `local`/`preview` (subject to the **P2** `TRANSFER` exception above).
- **REST pull (`revenuecat-client.ts:178-187,295-302`)**:
  Refuses `test_store` outside `local` and `preview` by returning `undefined` from `mapRevenueCatRestStore`, causing `projectSubscriber` to throw `RevenueCatUnsupportedStoreError` before expiry checks.

### 4. Database Enum Migration Safety (`a386c4d5`)

- **Location**: `packages/db/prisma/migrations/20261113120000_entitlement_store_test_store/migration.sql:1-5` (`ALTER TYPE "EntitlementStore" ADD VALUE 'test_store';`)
- **Deploy before code**: Safe on the project's PostgreSQL 17 runtime (`postgres:17-alpine` in `.github/workflows/pr-checks.yml:213`). Although `prisma migrate deploy` executes each migration file in a transaction, PostgreSQL >= 12 permits `ALTER TYPE ... ADD VALUE` inside a transaction as long as the new label is not referenced in SQL statements within that same transaction, and `migration.sql` contains no other statements. Existing application code and `@prisma/client` binaries continue functioning before rollout provided no row contains `'test_store'`.
- **Rollback**: Operational caveat (no bug): PostgreSQL has no `ALTER TYPE ... DROP VALUE`. Rolling back requires confirming zero `'test_store'` rows exist in `premium_entitlement` and `billing_event` and recreating/swapping the enum type.

### 5. `EntitlementStore` Readers Across Monorepo

- Searched `apps/` (`api`, `mobile`, `web`; no `apps/admin` exists) and `packages/`. Updated and aligned in:
  - `packages/api-client/src/contracts/http/subscription.ts:43-49`
  - `packages/api-client/src/generated/models/index.ts:6689-6697` & `packages/api-client/docs/http.openapi.json:7197-7206`
  - `packages/api-client/src/types/analytics-events.ts:682-688` (`premiumStoreAnalyticsEnum`)
  - `apps/mobile/src/lib/premium.ts:133-137` (`manageEntryFor`)
  - `apps/api/src/modules/commerce/stripe-billing.service.ts:137` (`entitlement.store !== 'stripe'` -> 409)
  - `apps/web/src/app/components/subscription-section.tsx:181` (no crash, see **P3**)

---

## Verification Executed

| Check                                                                                                                                                                                                                     | Result                                          | Scope / Notes                                                                     |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- | --------------------------------------------------------------------------------- |
| `node --test scripts/lib/live-font-*.test.mjs`                                                                                                                                                                            | **Pass** (102/102 tests, 15 suites)             | Baseline for `8d0bb7c4`                                                           |
| Stops-widening mutant at `scripts/lib/live-font-capture.mjs:612` in `/tmp/wt-615-mutant-r5`                                                                                                                               | **Killed** (`MUTANT_EXIT=1`, 101 pass / 1 fail) | Killed by `scripts/lib/live-font-capture.test.mjs:796`; worktree removed & pruned |
| `npm --workspace @couture/api-client exec -- vitest run --config vitest.config.ts testing/premium-access-contract.spec.ts testing/subscription-contract.spec.ts`                                                          | **Pass** (21/21 tests, 2 files)                 | `subscription-contract`: 16, `premium-access-contract`: 5                         |
| `NODE_OPTIONS=--conditions=development npm --workspace api exec -- vitest run src/config/runtime-environment.spec.ts src/modules/commerce/billing-webhook.service.spec.ts src/modules/commerce/revenuecat-client.spec.ts` | **Pass** (122/122 tests, 3 files)               | `runtime-environment`: 18, `revenuecat-client`: 31, `billing-webhook.service`: 73 |
| `npm --workspace mobile exec -- vitest run --config vitest.config.ts src/lib/premium.test.ts`                                                                                                                             | **Pass** (34/34 tests, 1 file)                  | Chromium Vitest browser run                                                       |
| `apps/api/integration/premium-{reconciliation,revenuecat-webhook,subscription}.integration.spec.ts`                                                                                                                       | **Not run**                                     | All 3 require PostgreSQL via `INTEGRATION_TEST_DATABASE_URL` / `requireSchema`    |

REVIEW-615-D15-R5-DONE

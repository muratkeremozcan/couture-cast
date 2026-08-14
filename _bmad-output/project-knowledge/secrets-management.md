# Secrets management

Updated: 2026-03-27 - replaced third-party secret-manager plan with the existing `.env` and GitHub/provider secret workflow.

## Decision

- No standalone secret manager is required for CoutureCast.
- Local development uses gitignored `.env` files such as `.env`, `.env.local`, `.env.preview`, and `.env.prod`.
- CI uses GitHub Actions secrets.
- Hosted environments use provider-native secret stores such as Vercel, Expo EAS, Supabase, Upstash, and other service dashboards.
- `.env.example` remains the canonical list of required variable names without real values.

## Environment workflow

### Local

- Keep populated `.env*` files out of version control.
- Use `.env.example` to bootstrap required keys.
- Prefer `.env.local` for machine-specific overrides.

### CI

- Store CI-only values in GitHub Actions repository or environment secrets.
- Scope production secrets to protected environments.
- Rotate tokens when access changes or a leak is suspected.

### Hosted

- Store runtime secrets in the platform that consumes them.
- Avoid duplicating secrets across systems unless a deployment target requires it.
- Keep least-privilege keys for each runtime surface.
- For the guardian invitation flow, use `_bmad-output/project-knowledge/guardian-invitation-env-setup.md`
  as the system-specific runbook for local, Vercel, and CI placement.

## Rotation policy

- Quarterly: `DATABASE_URL`, `JWT_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`, Redis tokens, deployment tokens.
- Annual: low-risk third-party API keys if they have not already been rotated.
- Immediate: any suspected compromise, offboarding event, or accidental exposure.

## Rotation procedure

1. Generate the replacement secret.
2. Update the relevant GitHub or provider-native secret store.
3. Redeploy or restart the affected environment.
4. Validate the application with the new value.
5. Revoke the old secret after verification.

## Leak prevention

- `gitleaks` is required in local workflows and CI.
- Never commit populated `.env*` files.
- Never store production credentials in screenshots, markdown examples, or tickets.
- Use neutral placeholders in project docs.

## Least-privilege guidance

- Use read-only keys where a client or read path does not need write access.
- Keep server-side elevated keys scoped to the narrowest runtime that needs them.
- Separate local, non-production, and production credentials.
- Weather provider credentials (`OPENWEATHER_API_KEY`, `WEATHERAPI_API_KEY`) are server-side worker
  secrets only. Store them in local gitignored `.env*` files, GitHub environment secrets for CI, and
  the non-serverless worker platform secret store for deployed runtimes.
- Keep OpenWeather daily-call caps aligned to the approved target count and cadence. For Story 1.1,
  budget 48 primary forecast calls per canonical target per day at a 30-minute cadence before
  retries.
- Rotate weather provider keys immediately if logs, tickets, screenshots, or test artifacts expose a
  provider key. Validate rotation by running the worker startup health check and observing provider
  request metrics in Grafana.

## Affiliate partner secrets (story 5.1)

Affiliate commerce introduces two kinds of secret and one unusual indirection
that is worth understanding before rotating either.

### `COMMERCE_CLICK_TOKEN_SECRET`

Keys the HMAC-SHA256 that turns an `AffiliateClick` row id into the base64url
token placed in the outbound partner URL. The row id itself never leaves the
system. This matters because the conversion webhook joins on that token and an
unknown token is recorded rather than rejected: if a raw cuid were in the URL,
any holder of a partner secret could attribute revenue to guessed identifiers.

Rotating it invalidates every outstanding click token, so conversions posted
against links a user already opened will land unmatched. Rotate on the quarterly
cadence or on suspected compromise, and expect a short tail of unmatched
conversions afterwards. That tail is visible: `affiliate_conversion_recorded`
carries `matched: false`.

### Per-partner webhook secrets

Each `CommercePartner` row stores `webhook_secret_ref`, which is the **name** of
an environment variable, never a secret value. The webhook resolves the signing
secret as `process.env[<value from that database row>]`.

That indirection is a read of an arbitrary environment variable chosen by
whoever can write a catalog row, so it is bounded twice:

1. A database check constraint requires
   `^COMMERCE_PARTNER_[A-Z0-9_]{1,40}_WEBHOOK_SECRET$`.
2. A runtime guard re-checks the same pattern before the lookup.

Both must stay. Removing either turns a catalog write into an environment read.

Secret values never enter the database, a log line, a fixture, or a commit. Only
the variable name is stored.

### Operator runbook: onboarding a real affiliate partner

There is no admin console. Catalog rows are seed and migration managed
(see `deferred-work.md`). To bring a partner live:

1. Choose a slug and derive the secret variable name from it, for example slug
   `acme-outfitters` gives `COMMERCE_PARTNER_ACME_OUTFITTERS_WEBHOOK_SECRET`.
2. Set that variable in the target environment's secret store, with at least 32
   random bytes. Share the same value with the partner over an agreed secure
   channel; it is what they sign webhook payloads with.
3. Insert the `CommercePartner` row via migration or service-role SQL with
   `status = 'inactive'`, the partner's registrable `allowed_host`, and
   `webhook_secret_ref` set to the variable name from step 1.
4. Insert `AffiliateOffer` rows, also `status = 'inactive'`. Each
   `deep_link_template` must be `https`, sit on `allowed_host` or a dot-suffix
   of it, and contain the literal `{clickToken}` placeholder. A template missing
   the placeholder is rejected at click time as misconfiguration.
5. Verify by signing a test webhook against the preview environment.
6. Flip the partner and its offers to `status = 'active'`.
7. Enable `commerce_affiliate_enabled` in PostHog for the intended audience.

Steps 3 and 4 default to `inactive` on purpose: a catalog that went live the
moment a row landed would be one typo away from an undisclosed affiliate link.

Name the accountable owner for the partner relationship in the pull request that
adds the rows.

### Non-production

`packages/db/prisma/seeds/commerce.ts` seeds one partner
(`slug: 'sample-partner'`, host `partner.couturecast.test`, a `.test` domain
reserved by RFC 2606 so it can never resolve publicly) and four wildcard offers,
and `seeds/feature-flags.ts` seeds `commerce_affiliate_enabled: true`. Both are
guarded so they are a no-op unless `NODE_ENV=test` or `TEST_ENV=local`. The
matching secret resolves through the same `allowsTestOnlySecrets()` fallback as
`WARDROBE_UPLOAD_TOKEN_SECRET`. None of this can exist in production.

## Premium billing secrets (story 5.2)

Premium subscriptions introduce two vendors (Stripe for web checkout,
RevenueCat as the entitlement ledger for all three stores) and six environment
variables. Every one validates at point of use — the server throws with an
actionable message at first use, never at boot — and every one falls back to a
deterministic test-only value under `allowsTestOnlySecrets()`. A set-but-
placeholder value is worse than an unset one: the server then verifies with one
secret while suites sign with the test fallback, and every valid webhook 401s.

| Variable                                                                         | Holds                                                                                                    | Rotation notes                                             |
| -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `STRIPE_SECRET_KEY`                                                              | Stripe API key (server only; test mode outside prod)                                                     | Rotate in the Stripe dashboard; sessions in flight survive |
| `STRIPE_WEBHOOK_SECRET`                                                          | Signing secret of our Stripe webhook endpoint                                                            | Stripe supports dual-active secrets during rotation        |
| `STRIPE_PREMIUM_MONTHLY_PRICE_ID` / `STRIPE_PREMIUM_ANNUAL_PRICE_ID`             | Price ids for the two plans                                                                              | Not secrets, but env-scoped: test-mode ids in non-prod     |
| `REVENUECAT_SECRET_API_KEY`                                                      | RC REST reads + Stripe receipt forwarding                                                                | Rotate in the RC dashboard                                 |
| `REVENUECAT_WEBHOOK_AUTH`                                                        | RC webhook credential (HMAC signing secret preferred; static Authorization value otherwise), >= 32 bytes | Rotating breaks in-flight deliveries briefly; RC retries   |
| `EXPO_PUBLIC_REVENUECAT_APPLE_API_KEY` / `EXPO_PUBLIC_REVENUECAT_GOOGLE_API_KEY` | RC public SDK keys                                                                                       | Public by design; still env-scoped per store app           |

### Operator runbook: provisioning premium subscriptions

Everything below is operator work the code cannot do, in dependency order.
The human-only release-gate subset lives in
`premium-release-checklist.md` and must be kept consistent with this list.

1. **App identity first — everything else is blocked on it.** Set
   `com.couturecast.app` (product-approved 2026-08-12) as the iOS
   `bundleIdentifier` and Android `package` in `apps/mobile/app.json`. An iOS
   bundle id cannot be changed after the App Store app record exists, and it is
   changeable at zero cost until then — revisit at record creation if a
   domain-matched id is preferred.
2. **Stores.** App Store Connect: app record + subscription group with
   `premium_monthly` / `premium_annual`. Play Console: app + base plans for the
   same two products. Launch pricing (resolved 2026-08-12): monthly $4.99 USD,
   annual $39.99 USD; nothing in code depends on the amounts.
3. **Stripe.** Products/Prices for both plans with per-locale currency
   presentation for the PRD locales (Checkout and Portal render prices, which
   is how PRD NFR Localization 2 is satisfied); Customer Portal configuration
   with cancel AND plan-switch enabled (this doubles as FR5.2's documented
   downgrade path); webhook endpoint pointed at
   `/api/v1/commerce/subscription/webhooks/stripe` + its signing secret.
4. **RevenueCat.** Project; entitlement id `premium`; both store apps; the
   Stripe integration (this is what makes forwarded web subscriptions land in
   the one ledger); webhook pointed at
   `/api/v1/commerce/subscription/webhooks/revenuecat` with HMAC signing
   preferred over the static header; confirm webhook + Stripe-integration
   availability on the free tier during setup, and note that forwarded Stripe
   revenue counts toward RC's monthly tracked revenue.
5. **Environment variables** from the table above, per environment.
6. **Staged smoke gate (release blocker).** Before the
   `commerce_subscription_enabled` flag turns on anywhere real: one full web
   chain in Stripe test mode + RC sandbox (checkout -> Stripe webhook ->
   forward -> RC webhook -> entitlement visible on
   `GET /api/v1/commerce/subscription`), and one sandbox store purchase on an
   EAS dev build. Nothing in CI executes the real chain — every provider is
   faked there — so this staged run is the only pre-production proof and is
   recorded as such.

Break-glass for a RevenueCat outage that leaves a customer paid-but-locked: an
RC promotional grant (the `promotional` store member exists exactly for this),
then let the reconciliation sweep true things up when RC recovers.

### Non-production

`packages/db/prisma/seeds/commerce.ts` also seeds three deterministic premium
users (`premium-active-user` with a Stripe customer mapping and its billing
event pair, `premium-expired-user`, `premium-grace-user`) and
`seeds/feature-flags.ts` seeds `commerce_subscription_enabled: true`, all
behind the same `allowsCommerceSeeding()` guard. Suites sign Stripe webhook
fixtures with the test-only `STRIPE_WEBHOOK_SECRET` via
`stripe.webhooks.generateTestHeaderString`; outbound Stripe calls and the
RevenueCat ledger resolve to deterministic fakes. None of this can exist in
production.

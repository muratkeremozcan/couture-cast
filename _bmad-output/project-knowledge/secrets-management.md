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

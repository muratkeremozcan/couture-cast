# Premium subscription release checklist (story 5.2)

The human-only gate before `commerce_subscription_enabled` turns on in any real
environment. The full provisioning runbook, with rationale and rotation notes,
lives in `secrets-management.md` (Premium billing secrets); this file is the
sign-off subset and must be kept consistent with it.

Accountable owner: named in the story 5.2 pull request description (5.1 C-8
rule). Solo-maintainer project: product, legal, and operator are the same
person, Murat.

## Blocking items, in order

- [ ] App identity `com.couturecast.app` set in `apps/mobile/app.json`
      (`bundleIdentifier` + Android `package`) and shipped in the store build.
      Revisit the id at App Store record creation if a domain-matched id is
      preferred — it is free to change until that record exists, impossible
      after.
- [ ] App Store Connect: app record, subscription group, `premium_monthly` and
      `premium_annual` approved.
- [ ] Play Console: app record and both base plans live, on a build carrying
      Play Billing Library 8+ (hard deadline for app updates: 2026-08-31).
- [ ] Stripe: both Prices with per-locale currency presentation; Customer
      Portal configured with cancel and plan-switch enabled; webhook endpoint +
      secret set.
- [ ] RevenueCat: `premium` entitlement, both store apps, Stripe integration,
      webhook (HMAC signing if available on our plan) + secret set; free-tier
      webhook/integration availability confirmed.
- [ ] All six environment variables set in the target environment (see the
      table in `secrets-management.md`); no placeholders.
- [ ] **Staged smoke run recorded:** one full web chain in Stripe test mode +
      RC sandbox (checkout → Stripe webhook → forward → RC webhook →
      entitlement visible on `GET /api/v1/commerce/subscription` within the
      2-minute promise), and one sandbox store purchase on an EAS dev build.
      This is the only pre-production proof of the real chain; CI fakes every
      provider.
- [ ] **Draft translations reviewed:** the nine non-English `commerce.premium.*`
      catalogs on both surfaces are machine-translation drafts and the
      disclosure strings are compliance copy (PRD NFR Localization 1). Human
      review is a release blocker, exactly as 5.1's Decision 16 treated the
      commerce tree.
- [ ] Flag flip: `commerce_subscription_enabled` on in PostHog for the intended
      audience — last, after everything above.

## Non-blocking but dated

- Play Billing 8 self-service extension (to 2026-11-01) exists if the store
  build slips; the pinned `react-native-purchases` v10.x already bundles
  Billing 8.
- Stripe-sourced cancellations can take ~2 hours to reflect in RevenueCat; the
  portal-return copy sets that expectation. No action, just do not treat it as
  an incident.

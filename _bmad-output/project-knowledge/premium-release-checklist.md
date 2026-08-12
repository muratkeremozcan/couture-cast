# Premium release checklist (human-only steps)

Created: 2026-08-12, alongside story CC-5.2 (`../implementation-artifacts/5-2-premium-subscription-lifecycle.md`).

Story CC-5.2 builds and tests the whole Premium subscription lifecycle against fakes: CI never
talks to Apple, Google, Stripe, or RevenueCat. The steps below are the parts no agent can do,
because they need the owner's legal identity, a payment card, or a physical device. Nothing here
is needed to develop or merge the story; all of it is needed before the
`commerce_subscription_enabled` flag turns on anywhere real.

Do them in order. The exact settings for each step (products, webhook secrets, per-locale
currency presentation) live in the story's Decision 9 operator runbook, which Task 10 folds into
[secrets-management.md](./secrets-management.md).

## 1. Create the accounts (identity + card required)

- [ ] Apple Developer Program: $99/year. Needed for App Store Connect and TestFlight.
- [ ] Google Play Console: $25 one-time.
- [ ] Stripe: business/individual details and a bank account for payouts.
- [ ] RevenueCat: free tier (free to $2,500 monthly tracked revenue, then ~1%). While signing up,
      confirm webhooks and the Stripe integration are available on the free tier (Decision 1
      flagged this as a provisioning-time check).

## 2. Create the products (config only, no code)

Follow Decision 9's dependency order. App identity is already decided and set by the story:
`com.couturecast.app` on both platforms (changeable at zero cost only until the App Store app
record below is created).

- [ ] App Store Connect: app record + subscription group with `premium_monthly` / `premium_annual`.
- [ ] Play Console: app record + base plans for the same two products.
- [ ] Stripe: Products/Prices (launch defaults from Open question 3: $4.99/month, $39.99/year USD),
      per-locale currency presentation, Customer Portal with cancel + plan switch enabled,
      webhook endpoint + secret.
- [ ] RevenueCat: project, `premium` entitlement, both store apps, Stripe integration,
      webhook + secret (signature auth preferred per Decision 1).
- [ ] Set the production env vars from Decision 10 in Vercel/EAS.
- [ ] Do NOT configure a free trial anywhere. Open question 2 resolved no-trial at launch;
      a trial is a deliberate future story with its own event and metric.

## 3. Staged smoke gate (release blocker)

Nothing in CI exercises the real payment chain, so this staged run is the only pre-production
proof and must be recorded as such (Decision 9 step 6):

- [ ] One full web chain in Stripe test mode + RevenueCat sandbox:
      checkout → Stripe webhook → forward → RC webhook → entitlement visible via
      `GET /api/v1/commerce/subscription`.
- [ ] One sandbox store purchase on a real phone, using an EAS dev build
      (purchases do not work in Expo Go).

## 4. Locale review (release blocker)

- [ ] Human review of the machine-translated Premium strings in all ten locale catalogs, both
      surfaces (AC 7; same release-blocker convention as story 5.1 Decision 16).

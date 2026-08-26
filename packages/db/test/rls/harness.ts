// The shared seeded-scenario harness behind every spec in this directory.
//
// One database scenario — a teen, a read-only guardian, a full-access guardian, an
// outsider guardian, an unrelated teen, and one row in every table the policies cover —
// seeded and torn down per test by the `scenarioTest` fixture. Splitting the suite by
// story kept this shared, because the actor matrix only means anything if every story
// asserts against the same set of actors.
//
// Adding a table to a story: extend the right category array below, add its ids to
// `SeededScenario`, insert it in `seedScenario`, delete it in `cleanupScenario` before
// the rows it depends on, and put the actor matrix in that story's own spec file.
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, it } from 'vitest'
import { Pool, type PoolClient } from 'pg'

const databaseUrl =
  process.env.RLS_TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgresql://postgres:postgres@127.0.0.1:54322/postgres'

export const guardianSharedTables = [
  'UserProfile',
  'ComfortPreferences',
  'GarmentItem',
  'PaletteInsights',
  'OutfitRecommendation',
  'OutfitCapsule',
  'OutfitCapsuleGarment',
  'WardrobeOnboardingState',
  'SilhouetteProfile',
] as const

export const selfOnlyTables = [
  'LookbookPost',
  'EngagementEvent',
  'SavedLocation',
  'AlertRule',
  'NotificationPreference',
  'PushToken',
  // Story 5.1: commerce preference and click trail are owner-only on purpose.
  // A purchase-intent trail is not something story 5.1 has a mandate to expose
  // to a guardian, so these sit here rather than in guardianSharedTables and
  // both consent levels are denied by the actor matrix below.
  'CommercePreference',
  'AffiliateClick',
  // Story 5.3: the premium palette choice is a cosmetic preference, not
  // privilege-bearing state, so it sits here beside CommercePreference rather
  // than with the worker-only billing tables. Guardians are denied for the same
  // reason as above: nothing in this story mandates exposing it.
  'PremiumThemePreference',
  // Story 5.4: a derived skin-tone/depth characteristic. Guardian consent
  // already gates WHETHER an under-16 account may upload at all (unchanged
  // WardrobeUploadGuard); exposing the derived body characteristic itself to
  // a guardian is a different mandate no planning document grants, unlike the
  // adjacent guardian-shared PaletteInsights (garment colour, not skin).
  'PaletteProfile',
  'AdvisorRecommendationState',
] as const

export const ownerOrGlobalReadTables = ['EventEnvelope'] as const

export const adminPool = new Pool({
  connectionString: databaseUrl,
  max: 8,
})

export type SeededScenario = {
  teenId: string
  teenEmail: string
  guardianReadOnlyId: string
  guardianReadOnlyEmail: string
  guardianFullAccessId: string
  guardianFullAccessEmail: string
  outsiderGuardianId: string
  outsiderGuardianEmail: string
  garmentId: string
  profileId: string
  comfortId: string
  paletteId: string
  outfitId: string
  postId: string
  eventId: string
  savedLocationId: string
  alertRuleId: string
  notificationPreferenceId: string
  pushTokenId: string
  pushToken: string
  eventEnvelopeId: string
  otherTeenId: string
  otherTeenEmail: string
  otherGarmentId: string
  otherSavedLocationId: string
  otherAlertRuleId: string
  otherNotificationPreferenceId: string
  otherPushTokenId: string
  otherPushToken: string
  otherEventEnvelopeId: string
  globalEventEnvelopeId: string
  consentReadOnlyId: string
  consentFullId: string
  capsuleId: string
  capsuleGarmentId: string
  onboardingStateId: string
  silhouetteProfileId: string
  commercePartnerId: string
  affiliateOfferId: string
  commercePreferenceId: string
  affiliateClickId: string
  affiliateConversionId: string
  otherCommercePreferenceId: string
  otherAffiliateClickId: string
  premiumEntitlementId: string
  billingEventId: string
  billingCustomerId: string
  premiumThemePreferenceId: string
  otherPremiumThemePreferenceId: string
  paletteProfileId: string
  otherPaletteProfileId: string
  advisorRecommendationStateId: string
  otherAdvisorRecommendationStateId: string
}

export const buildClaims = (email: string, role: string) => ({
  sub: randomUUID(),
  email,
  email_verified: true,
  role: 'authenticated',
  app_metadata: {
    role,
  },
})

export const withRole = async <T>(
  role: 'authenticated' | 'anon' | 'service_role',
  claims: Record<string, unknown> | null,
  run: (client: PoolClient) => Promise<T>
) => {
  const client = await adminPool.connect()

  try {
    await client.query('BEGIN')
    await client.query(`SET LOCAL ROLE ${role}`)

    if (claims) {
      await client.query('SELECT set_config($1, $2, true)', [
        'request.jwt.claims',
        JSON.stringify(claims),
      ])
    }

    return await run(client)
  } finally {
    try {
      await client.query('ROLLBACK')
    } catch {
      // Ignore rollback failures so the pooled client is still released.
    }
    client.release()
  }
}

const insertUser = async (client: PoolClient, id: string, email: string) => {
  await client.query(
    'INSERT INTO public."User" ("id", "email", "updated_at") VALUES ($1, $2, NOW())',
    [id, email]
  )
}

export const seedScenario = async (): Promise<SeededScenario> => {
  const suffix = randomUUID()

  const seeded: SeededScenario = {
    teenId: `teen-${suffix}`,
    teenEmail: `teen-${suffix}@example.com`,
    guardianReadOnlyId: `guardian-read-${suffix}`,
    guardianReadOnlyEmail: `guardian-read-${suffix}@example.com`,
    guardianFullAccessId: `guardian-full-${suffix}`,
    guardianFullAccessEmail: `guardian-full-${suffix}@example.com`,
    outsiderGuardianId: `guardian-outsider-${suffix}`,
    outsiderGuardianEmail: `guardian-outsider-${suffix}@example.com`,
    garmentId: `garment-${suffix}`,
    profileId: `profile-${suffix}`,
    comfortId: `comfort-${suffix}`,
    paletteId: `palette-${suffix}`,
    outfitId: `outfit-${suffix}`,
    postId: `post-${suffix}`,
    eventId: `event-${suffix}`,
    savedLocationId: `saved-location-${suffix}`,
    alertRuleId: `alert-rule-${suffix}`,
    notificationPreferenceId: `notification-preference-${suffix}`,
    pushTokenId: `push-token-${suffix}`,
    pushToken: `ExponentPushToken[owner-${suffix}]`,
    eventEnvelopeId: `event-envelope-${suffix}`,
    otherTeenId: `other-teen-${suffix}`,
    otherTeenEmail: `other-teen-${suffix}@example.com`,
    otherGarmentId: `other-garment-${suffix}`,
    otherSavedLocationId: `other-saved-location-${suffix}`,
    otherAlertRuleId: `other-alert-rule-${suffix}`,
    otherNotificationPreferenceId: `other-notification-preference-${suffix}`,
    otherPushTokenId: `other-push-token-${suffix}`,
    otherPushToken: `ExponentPushToken[other-${suffix}]`,
    otherEventEnvelopeId: `other-event-envelope-${suffix}`,
    globalEventEnvelopeId: `global-event-envelope-${suffix}`,
    consentReadOnlyId: `consent-read-${suffix}`,
    consentFullId: `consent-full-${suffix}`,
    capsuleId: `capsule-${suffix}`,
    capsuleGarmentId: `capsule-garment-${suffix}`,
    onboardingStateId: `onboarding-${suffix}`,
    silhouetteProfileId: `silhouette-${suffix}`,
    commercePartnerId: `commerce-partner-${suffix}`,
    affiliateOfferId: `affiliate-offer-${suffix}`,
    commercePreferenceId: `commerce-preference-${suffix}`,
    affiliateClickId: `affiliate-click-${suffix}`,
    affiliateConversionId: `affiliate-conversion-${suffix}`,
    otherCommercePreferenceId: `other-commerce-preference-${suffix}`,
    otherAffiliateClickId: `other-affiliate-click-${suffix}`,
    premiumEntitlementId: `premium-entitlement-${suffix}`,
    billingEventId: `billing-event-${suffix}`,
    billingCustomerId: `billing-customer-${suffix}`,
    premiumThemePreferenceId: `premium-theme-preference-${suffix}`,
    otherPremiumThemePreferenceId: `other-premium-theme-preference-${suffix}`,
    paletteProfileId: `palette-profile-${suffix}`,
    otherPaletteProfileId: `other-palette-profile-${suffix}`,
    advisorRecommendationStateId: `advisor-recommendation-${suffix}`,
    otherAdvisorRecommendationStateId: `other-advisor-recommendation-${suffix}`,
  }

  const client = await adminPool.connect()

  try {
    await client.query('BEGIN')

    await insertUser(client, seeded.teenId, seeded.teenEmail)
    await insertUser(client, seeded.guardianReadOnlyId, seeded.guardianReadOnlyEmail)
    await insertUser(client, seeded.guardianFullAccessId, seeded.guardianFullAccessEmail)
    await insertUser(client, seeded.outsiderGuardianId, seeded.outsiderGuardianEmail)
    await insertUser(client, seeded.otherTeenId, seeded.otherTeenEmail)

    await client.query(
      `INSERT INTO public."UserProfile"
        ("id", "user_id", "display_name", "preferences", "updated_at")
       VALUES ($1, $2, $3, $4::jsonb, NOW())`,
      [
        seeded.profileId,
        seeded.teenId,
        'Teen Wardrobe Owner',
        JSON.stringify({
          compliance: {
            accountStatus: 'active',
            guardianConsentRequired: false,
          },
        }),
      ]
    )

    await client.query(
      `INSERT INTO public."ComfortPreferences"
        ("id", "user_id", "runs_cold_warm", "wind_tolerance", "precip_preparedness", "updated_at")
       VALUES ($1, $2, 'neutral', 'medium', 'medium', NOW())`,
      [seeded.comfortId, seeded.teenId]
    )

    await client.query(
      `INSERT INTO public."GarmentItem"
        ("id", "user_id", "category", "updated_at")
       VALUES ($1, $2, $3, NOW())`,
      [seeded.garmentId, seeded.teenId, 'top']
    )
    await client.query(
      `INSERT INTO public."GarmentItem"
        ("id", "user_id", "category", "updated_at")
       VALUES ($1, $2, $3, NOW())`,
      [seeded.otherGarmentId, seeded.otherTeenId, 'dress']
    )

    await client.query(
      `INSERT INTO public."PaletteInsights"
        ("id", "garment_item_id", "user_id", "undertone", "updated_at")
       VALUES ($1, $2, $3, $4, NOW())`,
      [seeded.paletteId, seeded.garmentId, seeded.teenId, 'cool']
    )

    await client.query(
      `INSERT INTO public."OutfitRecommendation"
        ("id", "user_id", "scenario", "updated_at")
       VALUES ($1, $2, $3, NOW())`,
      [seeded.outfitId, seeded.teenId, 'school']
    )

    await client.query(
      `INSERT INTO public."OutfitCapsule"
        ("id", "user_id", "name", "occasions", "updated_at")
       VALUES ($1, $2, $3, $4::"CapsuleOccasion"[], NOW())`,
      [seeded.capsuleId, seeded.teenId, 'Spring Outfit', ['casual']]
    )

    await client.query(
      `INSERT INTO public."OutfitCapsuleGarment"
        ("id", "user_id", "capsule_id", "garment_id", "garment_order")
       VALUES ($1, $2, $3, $4, 0)`,
      [seeded.capsuleGarmentId, seeded.teenId, seeded.capsuleId, seeded.garmentId]
    )

    await client.query(
      `INSERT INTO public."WardrobeOnboardingState"
        ("id", "user_id", "status", "current_step", "updated_at")
       VALUES ($1, $2, 'in_progress', 'silhouette', NOW())`,
      [seeded.onboardingStateId, seeded.teenId]
    )

    await client.query(
      `INSERT INTO public."SilhouetteProfile"
        ("id", "user_id", "height_slider", "build_slider", "updated_at")
       VALUES ($1, $2, 50, 50, NOW())`,
      [seeded.silhouetteProfileId, seeded.teenId]
    )

    await client.query(
      `INSERT INTO public."LookbookPost"
        ("id", "user_id", "caption", "updated_at")
       VALUES ($1, $2, $3, NOW())`,
      [seeded.postId, seeded.teenId, 'private lookbook draft']
    )

    await client.query(
      `INSERT INTO public."EngagementEvent"
        ("id", "user_id", "post_id", "event_type")
       VALUES ($1, $2, $3, $4)`,
      [seeded.eventId, seeded.teenId, seeded.postId, 'liked']
    )

    await client.query(
      `INSERT INTO public."SavedLocation"
        (
          "id",
          "user_id",
          "label",
          "location_key",
          "latitude",
          "longitude",
          "timezone",
          "city",
          "region",
          "country",
          "is_primary",
          "sort_order",
          "updated_at"
        )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, TRUE, 0, NOW())`,
      [
        seeded.savedLocationId,
        seeded.teenId,
        'Home',
        `home-${suffix}`,
        41.878,
        -87.63,
        'America/Chicago',
        'Chicago',
        'IL',
        'US',
      ]
    )

    await client.query(
      `INSERT INTO public."SavedLocation"
        (
          "id",
          "user_id",
          "label",
          "location_key",
          "latitude",
          "longitude",
          "timezone",
          "city",
          "region",
          "country",
          "is_primary",
          "sort_order",
          "updated_at"
        )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, TRUE, 0, NOW())`,
      [
        seeded.otherSavedLocationId,
        seeded.otherTeenId,
        'Other Home',
        `other-home-${suffix}`,
        40.713,
        -74.006,
        'America/New_York',
        'New York',
        'NY',
        'US',
      ]
    )

    await client.query(
      `INSERT INTO public."AlertRule"
        ("id", "user_id", "rule_type", "threshold", "updated_at")
       VALUES
        ($1, $2, 'temperature', 8, NOW()),
        ($3, $4, 'temperature', 12, NOW())`,
      [seeded.alertRuleId, seeded.teenId, seeded.otherAlertRuleId, seeded.otherTeenId]
    )

    await client.query(
      `INSERT INTO public."NotificationPreference"
        (
          "id",
          "user_id",
          "quiet_hours_enabled",
          "push_enabled",
          "quiet_hours_start",
          "quiet_hours_end",
          "timezone",
          "updated_at"
        )
       VALUES
        ($1, $2, TRUE, TRUE, '22:00', '07:00', 'America/Chicago', NOW()),
        ($3, $4, FALSE, TRUE, '23:00', '06:00', 'America/New_York', NOW())`,
      [
        seeded.notificationPreferenceId,
        seeded.teenId,
        seeded.otherNotificationPreferenceId,
        seeded.otherTeenId,
      ]
    )

    await client.query(
      `INSERT INTO public."PushToken"
        ("id", "user_id", "token", "platform", "updated_at")
       VALUES
        ($1, $2, $3, 'ios', NOW()),
        ($4, $5, $6, 'android', NOW())`,
      [
        seeded.pushTokenId,
        seeded.teenId,
        seeded.pushToken,
        seeded.otherPushTokenId,
        seeded.otherTeenId,
        seeded.otherPushToken,
      ]
    )

    await client.query(
      `INSERT INTO public."EventEnvelope"
        ("id", "channel", "payload", "user_id", "updated_at")
       VALUES
        ($1, 'alert:weather', $2::jsonb, $3, NOW()),
        ($4, 'alert:weather', $5::jsonb, $6, NOW()),
        ($7, 'alert:weather', $8::jsonb, NULL, NOW())`,
      [
        seeded.eventEnvelopeId,
        JSON.stringify({ audience: 'owner' }),
        seeded.teenId,
        seeded.otherEventEnvelopeId,
        JSON.stringify({ audience: 'other-owner' }),
        seeded.otherTeenId,
        seeded.globalEventEnvelopeId,
        JSON.stringify({ audience: 'global' }),
      ]
    )

    await client.query(
      `INSERT INTO public."GuardianConsent"
        ("id", "guardian_id", "teen_id", "consent_level", "status", "ip_address")
       VALUES ($1, $2, $3, 'read_only', 'granted', '127.0.0.1')`,
      [seeded.consentReadOnlyId, seeded.guardianReadOnlyId, seeded.teenId]
    )

    await client.query(
      `INSERT INTO public."GuardianConsent"
        ("id", "guardian_id", "teen_id", "consent_level", "status", "ip_address")
       VALUES ($1, $2, $3, 'full_access', 'granted', '127.0.0.1')`,
      [seeded.consentFullId, seeded.guardianFullAccessId, seeded.teenId]
    )

    // Story 5.1 commerce fixtures. The catalog rows exist so the click rows
    // below can satisfy their foreign keys; the AC 5 matrix asserts the
    // `authenticated` role cannot reach the catalog at all.
    await client.query(
      `INSERT INTO public."CommercePartner"
        ("id", "slug", "display_name", "allowed_host", "status", "webhook_secret_ref", "updated_at")
       VALUES ($1, $2, 'RLS Fixture Partner', 'partner.couturecast.test', 'active',
               'COMMERCE_PARTNER_RLS_FIXTURE_WEBHOOK_SECRET', NOW())`,
      [seeded.commercePartnerId, `rls-fixture-${suffix}`]
    )

    await client.query(
      `INSERT INTO public."AffiliateOffer"
        ("id", "partner_id", "garment_category", "comfort_range", "locale_region",
         "title", "deep_link_template", "priority", "status", "effective_from", "updated_at")
       VALUES ($1, $2, 'top', NULL, '*', 'RLS Fixture Offer',
               'https://partner.couturecast.test/shop?cc={clickToken}', 0, 'active',
               NOW() - INTERVAL '1 day', NOW())`,
      [seeded.affiliateOfferId, seeded.commercePartnerId]
    )

    await client.query(
      `INSERT INTO public."CommercePreference"
        ("id", "user_id", "affiliate_ctas_enabled", "updated_at")
       VALUES ($1, $2, TRUE, NOW()), ($3, $4, TRUE, NOW())`,
      [
        seeded.commercePreferenceId,
        seeded.teenId,
        seeded.otherCommercePreferenceId,
        seeded.otherTeenId,
      ]
    )

    // Story 5.3. The owner's row carries a chosen palette and the unrelated
    // user's carries NULL (Default), so the actor matrix below proves both a
    // set value and the reset value are equally invisible across users.
    await client.query(
      `INSERT INTO public."PremiumThemePreference"
        ("id", "user_id", "theme", "updated_at")
       VALUES ($1, $2, 'jewel_radiance', NOW()), ($3, $4, NULL, NOW())`,
      [
        seeded.premiumThemePreferenceId,
        seeded.teenId,
        seeded.otherPremiumThemePreferenceId,
        seeded.otherTeenId,
      ]
    )

    // Story 5.4. The owner's row carries a consented, ready wardrobe-sourced
    // palette; the unrelated user's row carries no consent at all, so the
    // actor matrix below proves both a filled and an empty profile are
    // equally invisible across users.
    await client.query(
      `INSERT INTO public."PaletteProfile"
        ("id", "user_id", "consent_granted_at", "source", "undertone", "depth",
         "confidence", "analysis_version", "analyzed_at", "status", "updated_at")
       VALUES ($1, $2, NOW(), 'wardrobe', 'warm', NULL, 0.8, 'v1', NOW(), 'ready', NOW()),
              ($3, $4, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NOW())`,
      [
        seeded.paletteProfileId,
        seeded.teenId,
        seeded.otherPaletteProfileId,
        seeded.otherTeenId,
      ]
    )

    await client.query(
      `INSERT INTO public."AdvisorRecommendationState"
        ("id", "user_id", "slot", "item_key", "action", "updated_at")
       VALUES ($1, $2, 'foundation', 'advisor:foundation:warm', 'saved', NOW()),
              ($3, $4, 'blush', 'advisor:blush:cool', 'dismissed', NOW())`,
      [
        seeded.advisorRecommendationStateId,
        seeded.teenId,
        seeded.otherAdvisorRecommendationStateId,
        seeded.otherTeenId,
      ]
    )

    await client.query(
      `INSERT INTO public."AffiliateClick"
        ("id", "token", "user_id", "offer_id", "partner_id", "recommendation_id",
         "scenario", "surface", "locale_region")
       VALUES ($1, $2, $3, $4, $5, $6, 'school', 'mobile_hero', 'US'),
              ($7, $8, $9, $4, $5, $10, 'school', 'mobile_hero', 'US')`,
      [
        seeded.affiliateClickId,
        `click-token-owner-${suffix}`,
        seeded.teenId,
        seeded.affiliateOfferId,
        seeded.commercePartnerId,
        `recommendation-owner-${suffix}`,
        seeded.otherAffiliateClickId,
        `click-token-other-${suffix}`,
        seeded.otherTeenId,
        `recommendation-other-${suffix}`,
      ]
    )

    await client.query(
      `INSERT INTO public."AffiliateConversion"
        ("id", "partner_id", "external_event_id", "affiliate_click_id", "status",
         "order_value_minor_units", "currency", "occurred_at")
       VALUES ($1, $2, $3, $4, 'confirmed', 12900, 'USD', NOW())`,
      [
        seeded.affiliateConversionId,
        seeded.commercePartnerId,
        `external-event-${suffix}`,
        seeded.affiliateClickId,
      ]
    )

    // Story 5.2 billing fixtures. Rows exist for the teen so the worker-only
    // matrix below can prove an authenticated client cannot reach even its own
    // entitlement state: a client-forgeable entitlement row is free Premium.
    await client.query(
      `INSERT INTO public."PremiumEntitlement"
        ("id", "user_id", "status", "store", "product_id", "will_renew",
         "current_period_end", "synced_at", "last_event_occurred_at",
         "last_event_id", "updated_at")
       VALUES ($1, $2, 'active', 'stripe', 'premium_monthly', TRUE,
               NOW() + INTERVAL '30 days', NOW(), NOW(), $3, NOW())`,
      [seeded.premiumEntitlementId, seeded.teenId, `rls-fixture-event-${suffix}`]
    )

    await client.query(
      `INSERT INTO public."BillingEvent"
        ("id", "provider", "external_event_id", "event_type", "user_id",
         "store", "product_id", "payload", "occurred_at")
       VALUES ($1, 'revenuecat', $2, 'INITIAL_PURCHASE', $3,
               'stripe', 'premium_monthly', $4::jsonb, NOW())`,
      [
        seeded.billingEventId,
        `rls-fixture-billing-${suffix}`,
        seeded.teenId,
        JSON.stringify({ eventType: 'INITIAL_PURCHASE', store: 'stripe' }),
      ]
    )

    await client.query(
      `INSERT INTO public."BillingCustomer"
        ("id", "user_id", "stripe_customer_id", "updated_at")
       VALUES ($1, $2, $3, NOW())`,
      [seeded.billingCustomerId, seeded.teenId, `cus_rls_fixture_${suffix}`]
    )

    await client.query('COMMIT')
    return seeded
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

export const cleanupScenario = async (seeded: SeededScenario | undefined) => {
  if (!seeded) {
    return
  }

  const client = await adminPool.connect()

  try {
    await client.query('BEGIN')
    // Story 5.2 billing fixtures, deleted before the users they hang off:
    // events -> entitlements -> customers.
    await client.query('DELETE FROM public."BillingEvent" WHERE "id" = $1', [
      seeded.billingEventId,
    ])
    await client.query('DELETE FROM public."PremiumEntitlement" WHERE "id" = $1', [
      seeded.premiumEntitlementId,
    ])
    await client.query('DELETE FROM public."BillingCustomer" WHERE "id" = $1', [
      seeded.billingCustomerId,
    ])
    // Story 5.1 commerce fixtures, deleted in reverse dependency order:
    // conversions -> clicks -> offers -> partners, before the users they hang
    // off are removed below.
    await client.query('DELETE FROM public."AffiliateConversion" WHERE "id" = $1', [
      seeded.affiliateConversionId,
    ])
    await client.query('DELETE FROM public."AffiliateClick" WHERE "id" IN ($1, $2)', [
      seeded.affiliateClickId,
      seeded.otherAffiliateClickId,
    ])
    // Story 5.3 theme preferences, deleted before the users they hang off.
    await client.query(
      'DELETE FROM public."PremiumThemePreference" WHERE "id" IN ($1, $2)',
      [seeded.premiumThemePreferenceId, seeded.otherPremiumThemePreferenceId]
    )
    // Story 5.4 palette advisor fixtures, deleted before the users they hang off.
    await client.query(
      'DELETE FROM public."AdvisorRecommendationState" WHERE "id" IN ($1, $2)',
      [seeded.advisorRecommendationStateId, seeded.otherAdvisorRecommendationStateId]
    )
    await client.query('DELETE FROM public."PaletteProfile" WHERE "id" IN ($1, $2)', [
      seeded.paletteProfileId,
      seeded.otherPaletteProfileId,
    ])
    await client.query('DELETE FROM public."CommercePreference" WHERE "id" IN ($1, $2)', [
      seeded.commercePreferenceId,
      seeded.otherCommercePreferenceId,
    ])
    await client.query('DELETE FROM public."AffiliateOffer" WHERE "id" = $1', [
      seeded.affiliateOfferId,
    ])
    await client.query('DELETE FROM public."CommercePartner" WHERE "id" = $1', [
      seeded.commercePartnerId,
    ])
    await client.query('DELETE FROM public."EventEnvelope" WHERE "id" IN ($1, $2, $3)', [
      seeded.eventEnvelopeId,
      seeded.otherEventEnvelopeId,
      seeded.globalEventEnvelopeId,
    ])
    await client.query('DELETE FROM public."PushToken" WHERE "id" IN ($1, $2)', [
      seeded.pushTokenId,
      seeded.otherPushTokenId,
    ])
    await client.query(
      'DELETE FROM public."NotificationPreference" WHERE "id" IN ($1, $2)',
      [seeded.notificationPreferenceId, seeded.otherNotificationPreferenceId]
    )
    await client.query('DELETE FROM public."AlertRule" WHERE "id" IN ($1, $2)', [
      seeded.alertRuleId,
      seeded.otherAlertRuleId,
    ])
    await client.query('DELETE FROM public."EngagementEvent" WHERE "id" = $1', [
      seeded.eventId,
    ])
    await client.query('DELETE FROM public."SavedLocation" WHERE "id" IN ($1, $2)', [
      seeded.savedLocationId,
      seeded.otherSavedLocationId,
    ])
    await client.query('DELETE FROM public."LookbookPost" WHERE "id" = $1', [
      seeded.postId,
    ])
    await client.query('DELETE FROM public."SilhouetteProfile" WHERE "id" = $1', [
      seeded.silhouetteProfileId,
    ])
    await client.query('DELETE FROM public."WardrobeOnboardingState" WHERE "id" = $1', [
      seeded.onboardingStateId,
    ])
    await client.query('DELETE FROM public."OutfitRecommendation" WHERE "id" = $1', [
      seeded.outfitId,
    ])
    await client.query('DELETE FROM public."OutfitCapsuleGarment" WHERE "id" = $1', [
      seeded.capsuleGarmentId,
    ])
    await client.query('DELETE FROM public."OutfitCapsule" WHERE "id" = $1', [
      seeded.capsuleId,
    ])
    await client.query('DELETE FROM public."PaletteInsights" WHERE "id" = $1', [
      seeded.paletteId,
    ])
    await client.query('DELETE FROM public."GarmentItem" WHERE "id" = $1', [
      seeded.garmentId,
    ])
    await client.query('DELETE FROM public."GarmentItem" WHERE "id" = $1', [
      seeded.otherGarmentId,
    ])
    await client.query('DELETE FROM public."ComfortPreferences" WHERE "id" = $1', [
      seeded.comfortId,
    ])
    await client.query('DELETE FROM public."UserProfile" WHERE "id" = $1', [
      seeded.profileId,
    ])
    await client.query('DELETE FROM public."GuardianConsent" WHERE "id" IN ($1, $2)', [
      seeded.consentReadOnlyId,
      seeded.consentFullId,
    ])
    await client.query('DELETE FROM public."User" WHERE "id" IN ($1, $2, $3, $4, $5)', [
      seeded.teenId,
      seeded.guardianReadOnlyId,
      seeded.guardianFullAccessId,
      seeded.outsiderGuardianId,
      seeded.otherTeenId,
    ])
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

export const scenarioTest = it.extend<{ scenario: SeededScenario }>({
  scenario: async ({}, use) => {
    const seeded = await seedScenario()
    try {
      await use(seeded)
    } finally {
      await cleanupScenario(seeded)
    }
  },
})

let lifecycleRegistrations = 0

/**
 * Registers the per-file database lifecycle. Call it once inside each spec file's
 * top-level `describe`.
 *
 * The pool is module state, and `packages/db/vitest.config.ts` sets
 * `fileParallelism: false` so every suite in this workspace shares one process. Vitest's
 * default `isolate: true` still gives each spec file its own module registry, and
 * therefore its own `adminPool`, so one file ending its pool cannot strand the files
 * that run after it.
 *
 * That is a load-bearing assumption rather than an incidental one, so it is checked.
 * A second registration means two spec files reached the same module instance, which
 * only happens when isolation is off: the first file to finish would call
 * `adminPool.end()` and every later file would fail on a pool it never opened. The
 * counter turns that into one legible error instead of a cascade of
 * `Cannot use a pool after calling end` failures pointing at innocent specs.
 */
export const useRlsDatabase = () => {
  lifecycleRegistrations += 1

  if (lifecycleRegistrations > 1) {
    throw new Error(
      'Two spec files share one rls/harness.ts module instance, so the first suite to finish would close the pool the rest still need. Restore `isolate: true` in packages/db/vitest.config.ts.'
    )
  }

  beforeAll(async () => {
    let client: PoolClient | undefined

    try {
      client = await adminPool.connect()
      await client.query('SELECT 1 FROM public."GuardianInvitation" LIMIT 1')
    } catch (error) {
      throw new Error(
        'Guardian-aware RLS tests require a migrated target database. Run `npx prisma migrate deploy --schema packages/db/prisma/schema.prisma` against the RLS test DB before running this suite.',
        { cause: error }
      )
    } finally {
      client?.release()
    }
  })

  afterAll(async () => {
    await adminPool.end()
  })
}

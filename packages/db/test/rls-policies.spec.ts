// Learning path Step 4: Environment setup and Supabase operations.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-4-environment-setup-and-supabase-operations
// Learning path Step 18: Telemetry and audit baseline.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-18-telemetry-and-audit-baseline
// Learning path Step 29: Garment capture flow.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-29-garment-capture-flow
// Learning path Step 30: Smart tagging and comfort metadata.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-30-smart-tagging-and-comfort-metadata
// Learning path Step 31: Outfit capsule builder.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-31-outfit-capsule-builder
// Learning path Step 32: Wardrobe onboarding and silhouette setup.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-32-wardrobe-onboarding-and-silhouette-setup
// Learning path Step 33: Affiliate "Shop this look" CTA.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-33-affiliate-shop-this-look-cta
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Pool, type PoolClient } from 'pg'

const databaseUrl =
  process.env.RLS_TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgresql://postgres:postgres@127.0.0.1:54322/postgres'

const guardianSharedTables = [
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

const selfOnlyTables = [
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
] as const

const ownerOrGlobalReadTables = ['EventEnvelope'] as const

const adminPool = new Pool({
  connectionString: databaseUrl,
  max: 8,
})

type SeededScenario = {
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
}

const buildClaims = (email: string, role: string) => ({
  sub: randomUUID(),
  email,
  email_verified: true,
  role: 'authenticated',
  app_metadata: {
    role,
  },
})

const withRole = async <T>(
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

const seedScenario = async (): Promise<SeededScenario> => {
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

    await client.query('COMMIT')
    return seeded
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

const cleanupScenario = async (seeded: SeededScenario | undefined) => {
  if (!seeded) {
    return
  }

  const client = await adminPool.connect()

  try {
    await client.query('BEGIN')
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

const scenarioTest = it.extend<{ scenario: SeededScenario }>({
  scenario: async ({}, use) => {
    const seeded = await seedScenario()
    try {
      await use(seeded)
    } finally {
      await cleanupScenario(seeded)
    }
  },
})

describe.concurrent('guardian-aware RLS policies', () => {
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

  it('enables RLS and installs the expected policy sets', async () => {
    const targetTables = [
      ...guardianSharedTables,
      ...selfOnlyTables,
      ...ownerOrGlobalReadTables,
      'GuardianConsent',
      'telemetry_events',
    ]
    const client = await adminPool.connect()

    try {
      const rlsState = await client.query<{
        table_name: string
        rls_enabled: boolean
      }>(
        `SELECT c.relname AS table_name, c.relrowsecurity AS rls_enabled
         FROM pg_class AS c
         INNER JOIN pg_namespace AS n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public'
           AND c.relname = ANY($1::text[])`,
        [targetTables]
      )

      expect(rlsState.rows).toHaveLength(targetTables.length)
      expect(rlsState.rows.every((row) => row.rls_enabled)).toBe(true)

      const policies = await client.query<{
        table_name: string
        policy_name: string
      }>(
        `SELECT tablename AS table_name, policyname AS policy_name
         FROM pg_policies
         WHERE schemaname = 'public'
           AND tablename = ANY($1::text[])`,
        [targetTables]
      )

      const policyMap = new Map<string, Set<string>>()

      for (const row of policies.rows) {
        const existing = policyMap.get(row.table_name) ?? new Set<string>()
        existing.add(row.policy_name)
        policyMap.set(row.table_name, existing)
      }

      for (const tableName of guardianSharedTables) {
        expect(policyMap.get(tableName)).toEqual(
          new Set([
            'authenticated_read_shared_user_data',
            'authenticated_insert_shared_user_data',
            'authenticated_update_shared_user_data',
            'authenticated_delete_shared_user_data',
          ])
        )
      }

      for (const tableName of selfOnlyTables) {
        expect(policyMap.get(tableName)).toEqual(
          new Set([
            'authenticated_read_own_user_data',
            'authenticated_insert_own_user_data',
            'authenticated_update_own_user_data',
            'authenticated_delete_own_user_data',
          ])
        )
      }

      expect(policyMap.get('EventEnvelope')).toEqual(
        new Set(['authenticated_read_own_or_global_events'])
      )

      expect(policyMap.get('GuardianConsent')).toEqual(
        new Set(['authenticated_read_guardian_consent'])
      )

      expect(policyMap.get('telemetry_events')).toEqual(
        new Set([
          'authenticated_read_own_telemetry',
          'authenticated_insert_telemetry',
          'service_role_insert_telemetry',
        ])
      )
    } finally {
      client.release()
    }
  })

  it('keeps alert delivery coordination tables worker-only', async () => {
    const privateTables = ['AlertDeliveryOutbox', 'AlertCooldownReservation'] as const
    const client = await adminPool.connect()

    try {
      const rlsState = await client.query<{
        table_name: string
        rls_enabled: boolean
      }>(
        `SELECT c.relname AS table_name, c.relrowsecurity AS rls_enabled
         FROM pg_class AS c
         INNER JOIN pg_namespace AS n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public'
           AND c.relname = ANY($1::text[])`,
        [privateTables]
      )

      expect(rlsState.rows).toHaveLength(privateTables.length)
      expect(rlsState.rows.every((row) => row.rls_enabled)).toBe(true)

      const policies = await client.query(
        `SELECT policyname
         FROM pg_policies
         WHERE schemaname = 'public'
           AND tablename = ANY($1::text[])`,
        [privateTables]
      )
      expect(policies.rows).toEqual([])

      const clientGrants = await client.query(
        `SELECT grantee, table_name, privilege_type
         FROM information_schema.role_table_grants
         WHERE table_schema = 'public'
           AND table_name = ANY($1::text[])
           AND grantee = ANY($2::text[])`,
        [privateTables, ['anon', 'authenticated']]
      )
      expect(clientGrants.rows).toEqual([])
    } finally {
      client.release()
    }
  })

  scenarioTest(
    'allows teens to read and update their own wardrobe-scoped rows',
    async ({ scenario: seeded }) => {
      await withRole(
        'authenticated',
        buildClaims(seeded.teenEmail, 'teen'),
        async (client) => {
          const garmentRows = await client.query<{
            id: string
            category: string
          }>('SELECT "id", "category" FROM public."GarmentItem" WHERE "user_id" = $1', [
            seeded.teenId,
          ])

          expect(garmentRows.rows).toEqual([
            {
              id: seeded.garmentId,
              category: 'top',
            },
          ])

          await client.query(
            'UPDATE public."GarmentItem" SET "category" = $1, "updated_at" = NOW() WHERE "id" = $2',
            ['outerwear', seeded.garmentId]
          )

          const updatedProfile = await client.query<{
            display_name: string
          }>('SELECT "display_name" FROM public."UserProfile" WHERE "user_id" = $1', [
            seeded.teenId,
          ])

          expect(updatedProfile.rows[0]?.display_name).toBe('Teen Wardrobe Owner')

          const savedLocationRows = await client.query<{
            id: string
            label: string
          }>('SELECT "id", "label" FROM public."SavedLocation" WHERE "user_id" = $1', [
            seeded.teenId,
          ])

          expect(savedLocationRows.rows).toEqual([
            {
              id: seeded.savedLocationId,
              label: 'Home',
            },
          ])

          const updateLocationResult = await client.query(
            `UPDATE public."SavedLocation"
           SET "label" = $1, "updated_at" = NOW()
           WHERE "id" = $2
           RETURNING "label"`,
            ['Office', seeded.savedLocationId]
          )

          expect(updateLocationResult.rows).toEqual([{ label: 'Office' }])
        }
      )
    }
  )

  scenarioTest(
    'lets linked guardians read teen wardrobe data but blocks read-only mutations',
    async ({ scenario: seeded }) => {
      await withRole(
        'authenticated',
        buildClaims(seeded.guardianReadOnlyEmail, 'guardian'),
        async (client) => {
          const garmentRows = await client.query<{
            id: string
          }>('SELECT "id" FROM public."GarmentItem" WHERE "user_id" = $1', [
            seeded.teenId,
          ])

          expect(garmentRows.rows).toHaveLength(1)

          const consentRows = await client.query<{
            teen_id: string
          }>('SELECT "teen_id" FROM public."GuardianConsent" WHERE "guardian_id" = $1', [
            seeded.guardianReadOnlyId,
          ])

          expect(consentRows.rows).toEqual([{ teen_id: seeded.teenId }])

          const updateResult = await client.query(
            `UPDATE public."GarmentItem"
           SET "category" = $1, "updated_at" = NOW()
           WHERE "id" = $2
           RETURNING "id"`,
            ['outerwear', seeded.garmentId]
          )

          expect(updateResult.rowCount).toBe(0)
        }
      )
    }
  )

  scenarioTest(
    'grants wardrobe access from a single active guardian consent row',
    async ({ scenario: seeded }) => {
      const client = await adminPool.connect()

      try {
        await client.query('DELETE FROM public."GuardianConsent" WHERE "id" = $1', [
          seeded.consentFullId,
        ])
      } finally {
        client.release()
      }

      await withRole(
        'authenticated',
        buildClaims(seeded.teenEmail, 'teen'),
        async (client) => {
          const teenGarments = await client.query(
            'SELECT "id" FROM public."GarmentItem" WHERE "user_id" = $1',
            [seeded.teenId]
          )

          expect(teenGarments.rows).toEqual([{ id: seeded.garmentId }])
        }
      )

      await withRole(
        'authenticated',
        buildClaims(seeded.guardianReadOnlyEmail, 'guardian'),
        async (client) => {
          const guardianGarments = await client.query(
            'SELECT "id" FROM public."GarmentItem" WHERE "user_id" = $1',
            [seeded.teenId]
          )

          expect(guardianGarments.rows).toEqual([{ id: seeded.garmentId }])
        }
      )
    }
  )

  scenarioTest(
    'lets full-access guardians mutate linked teen wardrobe rows',
    async ({ scenario: seeded }) => {
      await withRole(
        'authenticated',
        buildClaims(seeded.guardianFullAccessEmail, 'guardian'),
        async (client) => {
          const updateResult = await client.query<{
            category: string
          }>(
            `UPDATE public."GarmentItem"
           SET "category" = $1, "updated_at" = NOW()
           WHERE "id" = $2
           RETURNING "category"`,
            ['outerwear', seeded.garmentId]
          )

          expect(updateResult.rows).toEqual([{ category: 'outerwear' }])

          const insertResult = await client.query<{
            id: string
          }>(
            `INSERT INTO public."OutfitRecommendation"
            ("id", "user_id", "scenario", "updated_at")
           VALUES ($1, $2, $3, NOW())
           RETURNING "id"`,
            [`guardian-created-outfit-${randomUUID()}`, seeded.teenId, 'school-run']
          )

          expect(insertResult.rows).toHaveLength(1)
        }
      )
    }
  )

  scenarioTest(
    '4.3-DB-003 lets the capsule owner read and mutate both capsule tables',
    async ({ scenario: seeded }) => {
      await withRole(
        'authenticated',
        buildClaims(seeded.teenEmail, 'teen'),
        async (client) => {
          const capsules = await client.query(
            'SELECT "id" FROM public."OutfitCapsule" WHERE "user_id" = $1',
            [seeded.teenId]
          )
          expect(capsules.rows).toEqual([{ id: seeded.capsuleId }])

          const joins = await client.query(
            'SELECT "id" FROM public."OutfitCapsuleGarment" WHERE "capsule_id" = $1',
            [seeded.capsuleId]
          )
          expect(joins.rows).toEqual([{ id: seeded.capsuleGarmentId }])

          const renamed = await client.query(
            `UPDATE public."OutfitCapsule"
             SET "name" = $1, "updated_at" = NOW()
             WHERE "id" = $2
             RETURNING "name"`,
            ['Owner renamed capsule', seeded.capsuleId]
          )
          expect(renamed.rows).toEqual([{ name: 'Owner renamed capsule' }])

          // Delete then reinsert the join so the assertion needs no second garment.
          const removedJoin = await client.query(
            'DELETE FROM public."OutfitCapsuleGarment" WHERE "id" = $1 RETURNING "id"',
            [seeded.capsuleGarmentId]
          )
          expect(removedJoin.rows).toEqual([{ id: seeded.capsuleGarmentId }])

          const reinsertedJoin = await client.query(
            `INSERT INTO public."OutfitCapsuleGarment"
              ("id", "user_id", "capsule_id", "garment_id", "garment_order")
             VALUES ($1, $2, $3, $4, 0)
             RETURNING "id"`,
            [seeded.capsuleGarmentId, seeded.teenId, seeded.capsuleId, seeded.garmentId]
          )
          expect(reinsertedJoin.rows).toEqual([{ id: seeded.capsuleGarmentId }])

          const insertedCapsule = await client.query(
            `INSERT INTO public."OutfitCapsule"
              ("id", "user_id", "name", "occasions", "updated_at")
             VALUES ($1, $2, $3, $4::"CapsuleOccasion"[], NOW())
             RETURNING "id"`,
            [`owner-capsule-${randomUUID()}`, seeded.teenId, 'Owner created', ['work']]
          )
          expect(insertedCapsule.rows).toHaveLength(1)

          const deletedCapsule = await client.query(
            'DELETE FROM public."OutfitCapsule" WHERE "id" = $1 RETURNING "id"',
            [seeded.capsuleId]
          )
          expect(deletedCapsule.rows).toEqual([{ id: seeded.capsuleId }])
        }
      )
    }
  )

  scenarioTest(
    '4.3-DB-003 gives read-only guardians capsule reads without any capsule write',
    async ({ scenario: seeded }) => {
      await withRole(
        'authenticated',
        buildClaims(seeded.guardianReadOnlyEmail, 'guardian'),
        async (client) => {
          const capsules = await client.query(
            'SELECT "id" FROM public."OutfitCapsule" WHERE "user_id" = $1',
            [seeded.teenId]
          )
          expect(capsules.rows).toEqual([{ id: seeded.capsuleId }])

          const joins = await client.query(
            'SELECT "id" FROM public."OutfitCapsuleGarment" WHERE "capsule_id" = $1',
            [seeded.capsuleId]
          )
          expect(joins.rows).toEqual([{ id: seeded.capsuleGarmentId }])

          // UPDATE and DELETE are filtered to zero visible rows.
          const blockedUpdate = await client.query(
            `UPDATE public."OutfitCapsule"
             SET "name" = $1, "updated_at" = NOW()
             WHERE "id" = $2
             RETURNING "id"`,
            ['Blocked rename', seeded.capsuleId]
          )
          expect(blockedUpdate.rows).toHaveLength(0)

          const blockedDelete = await client.query(
            'DELETE FROM public."OutfitCapsule" WHERE "id" = $1 RETURNING "id"',
            [seeded.capsuleId]
          )
          expect(blockedDelete.rows).toHaveLength(0)

          const blockedJoinUpdate = await client.query(
            `UPDATE public."OutfitCapsuleGarment"
             SET "garment_order" = 1
             WHERE "id" = $1
             RETURNING "id"`,
            [seeded.capsuleGarmentId]
          )
          expect(blockedJoinUpdate.rows).toHaveLength(0)

          const blockedJoinDelete = await client.query(
            'DELETE FROM public."OutfitCapsuleGarment" WHERE "id" = $1 RETURNING "id"',
            [seeded.capsuleGarmentId]
          )
          expect(blockedJoinDelete.rows).toHaveLength(0)
        }
      )

      // INSERT is refused by the WITH CHECK clause rather than filtered, and a
      // refused statement aborts its transaction, so it needs its own session.
      await withRole(
        'authenticated',
        buildClaims(seeded.guardianReadOnlyEmail, 'guardian'),
        async (client) => {
          await expect(
            client.query(
              `INSERT INTO public."OutfitCapsule"
                ("id", "user_id", "name", "occasions", "updated_at")
               VALUES ($1, $2, $3, $4::"CapsuleOccasion"[], NOW())`,
              [
                `read-only-capsule-${randomUUID()}`,
                seeded.teenId,
                'Blocked capsule',
                ['work'],
              ]
            )
          ).rejects.toMatchObject({ code: '42501' })
        }
      )
    }
  )

  scenarioTest(
    '4.3-DB-003 lets full-access guardians mutate linked teen capsules and joins',
    async ({ scenario: seeded }) => {
      await withRole(
        'authenticated',
        buildClaims(seeded.guardianFullAccessEmail, 'guardian'),
        async (client) => {
          const renamed = await client.query(
            `UPDATE public."OutfitCapsule"
             SET "name" = $1, "revision" = "revision" + 1, "updated_at" = NOW()
             WHERE "id" = $2
             RETURNING "name", "revision"`,
            ['Guardian renamed capsule', seeded.capsuleId]
          )
          expect(renamed.rows).toEqual([
            { name: 'Guardian renamed capsule', revision: 1 },
          ])

          const insertedCapsule = await client.query(
            `INSERT INTO public."OutfitCapsule"
              ("id", "user_id", "name", "occasions", "updated_at")
             VALUES ($1, $2, $3, $4::"CapsuleOccasion"[], NOW())
             RETURNING "id"`,
            [
              `guardian-capsule-${randomUUID()}`,
              seeded.teenId,
              'Guardian created',
              ['casual'],
            ]
          )
          expect(insertedCapsule.rows).toHaveLength(1)

          const reorderedJoin = await client.query(
            `UPDATE public."OutfitCapsuleGarment"
             SET "garment_order" = 1
             WHERE "id" = $1
             RETURNING "garment_order"`,
            [seeded.capsuleGarmentId]
          )
          expect(reorderedJoin.rows).toEqual([{ garment_order: 1 }])

          const deletedJoin = await client.query(
            'DELETE FROM public."OutfitCapsuleGarment" WHERE "id" = $1 RETURNING "id"',
            [seeded.capsuleGarmentId]
          )
          expect(deletedJoin.rows).toEqual([{ id: seeded.capsuleGarmentId }])
        }
      )
    }
  )

  scenarioTest(
    '4.3-DB-003 grants admins capsule reads across both tables',
    async ({ scenario: seeded }) => {
      await withRole(
        'authenticated',
        buildClaims(`admin-${randomUUID()}@example.com`, 'admin'),
        async (client) => {
          const capsules = await client.query(
            'SELECT "id" FROM public."OutfitCapsule" WHERE "user_id" = $1',
            [seeded.teenId]
          )
          expect(capsules.rows).toEqual([{ id: seeded.capsuleId }])

          const joins = await client.query(
            'SELECT "id" FROM public."OutfitCapsuleGarment" WHERE "capsule_id" = $1',
            [seeded.capsuleId]
          )
          expect(joins.rows).toEqual([{ id: seeded.capsuleGarmentId }])
        }
      )
    }
  )

  scenarioTest(
    '4.3-DB-003 blocks capsule access after a guardian consent is revoked',
    async ({ scenario: seeded }) => {
      const adminClient = await adminPool.connect()

      try {
        await adminClient.query(
          `UPDATE public."GuardianConsent"
           SET "revoked_at" = NOW(), "status" = 'revoked'
           WHERE "id" = $1`,
          [seeded.consentFullId]
        )
      } finally {
        adminClient.release()
      }

      await withRole(
        'authenticated',
        buildClaims(seeded.guardianFullAccessEmail, 'guardian'),
        async (client) => {
          const capsules = await client.query(
            'SELECT "id" FROM public."OutfitCapsule" WHERE "user_id" = $1',
            [seeded.teenId]
          )
          expect(capsules.rows).toHaveLength(0)

          const joins = await client.query(
            'SELECT "id" FROM public."OutfitCapsuleGarment" WHERE "capsule_id" = $1',
            [seeded.capsuleId]
          )
          expect(joins.rows).toHaveLength(0)

          const blockedUpdate = await client.query(
            `UPDATE public."OutfitCapsule"
             SET "name" = $1, "updated_at" = NOW()
             WHERE "id" = $2
             RETURNING "id"`,
            ['Revoked rename', seeded.capsuleId]
          )
          expect(blockedUpdate.rows).toHaveLength(0)
        }
      )
    }
  )

  scenarioTest(
    '4.3-DB-003 blocks unrelated, unverified, spoofed, and anonymous capsule access',
    async ({ scenario: seeded }) => {
      await withRole(
        'authenticated',
        buildClaims(seeded.outsiderGuardianEmail, 'guardian'),
        async (client) => {
          const capsules = await client.query(
            'SELECT "id" FROM public."OutfitCapsule" WHERE "user_id" = $1',
            [seeded.teenId]
          )
          expect(capsules.rows).toHaveLength(0)
        }
      )

      // An unverified email claim must never resolve to the teen identity.
      await withRole(
        'authenticated',
        {
          sub: randomUUID(),
          email: seeded.teenEmail,
          email_verified: false,
          role: 'authenticated',
          app_metadata: { role: 'guardian' },
        },
        async (client) => {
          const capsules = await client.query(
            'SELECT "id" FROM public."OutfitCapsule" WHERE "user_id" = $1',
            [seeded.teenId]
          )
          expect(capsules.rows).toHaveLength(0)
        }
      )

      // Elevated role claims in user_metadata are attacker-controlled.
      await withRole(
        'authenticated',
        {
          sub: randomUUID(),
          email: `spoofed-${randomUUID()}@example.com`,
          email_verified: true,
          role: 'authenticated',
          user_metadata: { role: 'admin', email: seeded.teenEmail },
        },
        async (client) => {
          const capsules = await client.query(
            'SELECT "id" FROM public."OutfitCapsule" WHERE "user_id" = $1',
            [seeded.teenId]
          )
          expect(capsules.rows).toHaveLength(0)
        }
      )

      // The anon role lacks table grants, so each refusal aborts its own
      // transaction and every table needs a separate session.
      await withRole('anon', null, async (client) => {
        await expect(
          client.query('SELECT "id" FROM public."OutfitCapsule" WHERE "user_id" = $1', [
            seeded.teenId,
          ])
        ).rejects.toMatchObject({ code: '42501' })
      })

      await withRole('anon', null, async (client) => {
        await expect(
          client.query(
            'SELECT "id" FROM public."OutfitCapsuleGarment" WHERE "capsule_id" = $1',
            [seeded.capsuleId]
          )
        ).rejects.toMatchObject({ code: '42501' })
      })
    }
  )

  scenarioTest(
    '4.4-DB-003 lets the onboarding-state and silhouette-profile owner read, mutate, delete, and reinsert both rows',
    async ({ scenario: seeded }) => {
      await withRole(
        'authenticated',
        buildClaims(seeded.teenEmail, 'teen'),
        async (client) => {
          const onboarding = await client.query(
            'SELECT "id", "current_step" FROM public."WardrobeOnboardingState" WHERE "user_id" = $1',
            [seeded.teenId]
          )
          expect(onboarding.rows).toEqual([
            { id: seeded.onboardingStateId, current_step: 'silhouette' },
          ])

          const silhouette = await client.query(
            'SELECT "id", "height_slider" FROM public."SilhouetteProfile" WHERE "user_id" = $1',
            [seeded.teenId]
          )
          expect(silhouette.rows).toEqual([
            { id: seeded.silhouetteProfileId, height_slider: 50 },
          ])

          const advanced = await client.query(
            `UPDATE public."WardrobeOnboardingState"
             SET "current_step" = 'complete', "status" = 'completed', "revision" = "revision" + 1, "updated_at" = NOW()
             WHERE "id" = $1
             RETURNING "current_step", "revision"`,
            [seeded.onboardingStateId]
          )
          expect(advanced.rows).toEqual([{ current_step: 'complete', revision: 1 }])

          const slid = await client.query(
            `UPDATE public."SilhouetteProfile"
             SET "height_slider" = 70, "revision" = "revision" + 1, "updated_at" = NOW()
             WHERE "id" = $1
             RETURNING "height_slider", "revision"`,
            [seeded.silhouetteProfileId]
          )
          expect(slid.rows).toEqual([{ height_slider: 70, revision: 1 }])

          // The declared INSERT/DELETE policies are exercised here too, not
          // just SELECT/UPDATE, since a singleton one-row-per-user table
          // never naturally hits INSERT once the fixture seeds a row.
          const deletedOnboarding = await client.query(
            'DELETE FROM public."WardrobeOnboardingState" WHERE "id" = $1 RETURNING "id"',
            [seeded.onboardingStateId]
          )
          expect(deletedOnboarding.rows).toEqual([{ id: seeded.onboardingStateId }])

          const reinsertedOnboarding = await client.query(
            `INSERT INTO public."WardrobeOnboardingState" ("id", "user_id", "updated_at")
             VALUES ($1, $2, NOW())
             RETURNING "id"`,
            [`owner-onboarding-${randomUUID()}`, seeded.teenId]
          )
          expect(reinsertedOnboarding.rows).toHaveLength(1)

          const deletedSilhouette = await client.query(
            'DELETE FROM public."SilhouetteProfile" WHERE "id" = $1 RETURNING "id"',
            [seeded.silhouetteProfileId]
          )
          expect(deletedSilhouette.rows).toEqual([{ id: seeded.silhouetteProfileId }])

          const reinsertedSilhouette = await client.query(
            `INSERT INTO public."SilhouetteProfile" ("id", "user_id", "updated_at")
             VALUES ($1, $2, NOW())
             RETURNING "id"`,
            [`owner-silhouette-${randomUUID()}`, seeded.teenId]
          )
          expect(reinsertedSilhouette.rows).toHaveLength(1)
        }
      )
    }
  )

  scenarioTest(
    '4.4-DB-003 gives read-only guardians reads without any onboarding or silhouette write',
    async ({ scenario: seeded }) => {
      await withRole(
        'authenticated',
        buildClaims(seeded.guardianReadOnlyEmail, 'guardian'),
        async (client) => {
          const onboarding = await client.query(
            'SELECT "id" FROM public."WardrobeOnboardingState" WHERE "user_id" = $1',
            [seeded.teenId]
          )
          expect(onboarding.rows).toEqual([{ id: seeded.onboardingStateId }])

          const silhouette = await client.query(
            'SELECT "id" FROM public."SilhouetteProfile" WHERE "user_id" = $1',
            [seeded.teenId]
          )
          expect(silhouette.rows).toEqual([{ id: seeded.silhouetteProfileId }])

          const blockedOnboardingUpdate = await client.query(
            `UPDATE public."WardrobeOnboardingState"
             SET "current_step" = 'complete', "updated_at" = NOW()
             WHERE "id" = $1
             RETURNING "id"`,
            [seeded.onboardingStateId]
          )
          expect(blockedOnboardingUpdate.rows).toHaveLength(0)

          const blockedSilhouetteUpdate = await client.query(
            `UPDATE public."SilhouetteProfile"
             SET "height_slider" = 90, "updated_at" = NOW()
             WHERE "id" = $1
             RETURNING "id"`,
            [seeded.silhouetteProfileId]
          )
          expect(blockedSilhouetteUpdate.rows).toHaveLength(0)

          // DELETE is filtered to zero visible rows, same as UPDATE.
          const blockedOnboardingDelete = await client.query(
            'DELETE FROM public."WardrobeOnboardingState" WHERE "id" = $1 RETURNING "id"',
            [seeded.onboardingStateId]
          )
          expect(blockedOnboardingDelete.rows).toHaveLength(0)

          const blockedSilhouetteDelete = await client.query(
            'DELETE FROM public."SilhouetteProfile" WHERE "id" = $1 RETURNING "id"',
            [seeded.silhouetteProfileId]
          )
          expect(blockedSilhouetteDelete.rows).toHaveLength(0)
        }
      )

      // INSERT is refused by the WITH CHECK clause rather than filtered, and a
      // refused statement aborts its transaction, so it needs its own
      // session. The pre-seeded row is removed first so the failure is
      // unambiguously the RLS check rather than the one-row-per-user unique
      // constraint.
      const adminClient = await adminPool.connect()
      try {
        await adminClient.query(
          'DELETE FROM public."WardrobeOnboardingState" WHERE "id" = $1',
          [seeded.onboardingStateId]
        )
        await adminClient.query(
          'DELETE FROM public."SilhouetteProfile" WHERE "id" = $1',
          [seeded.silhouetteProfileId]
        )
      } finally {
        adminClient.release()
      }

      await withRole(
        'authenticated',
        buildClaims(seeded.guardianReadOnlyEmail, 'guardian'),
        async (client) => {
          await expect(
            client.query(
              `INSERT INTO public."WardrobeOnboardingState" ("id", "user_id", "updated_at")
               VALUES ($1, $2, NOW())`,
              [`blocked-onboarding-${randomUUID()}`, seeded.teenId]
            )
          ).rejects.toMatchObject({ code: '42501' })
        }
      )

      await withRole(
        'authenticated',
        buildClaims(seeded.guardianReadOnlyEmail, 'guardian'),
        async (client) => {
          await expect(
            client.query(
              `INSERT INTO public."SilhouetteProfile" ("id", "user_id", "updated_at")
               VALUES ($1, $2, NOW())`,
              [`blocked-silhouette-${randomUUID()}`, seeded.teenId]
            )
          ).rejects.toMatchObject({ code: '42501' })
        }
      )
    }
  )

  scenarioTest(
    '4.4-DB-003 lets full-access guardians mutate, delete, and recreate linked teen onboarding and silhouette rows',
    async ({ scenario: seeded }) => {
      await withRole(
        'authenticated',
        buildClaims(seeded.guardianFullAccessEmail, 'guardian'),
        async (client) => {
          const advanced = await client.query(
            `UPDATE public."WardrobeOnboardingState"
             SET "current_step" = 'complete', "revision" = "revision" + 1, "updated_at" = NOW()
             WHERE "id" = $1
             RETURNING "current_step"`,
            [seeded.onboardingStateId]
          )
          expect(advanced.rows).toEqual([{ current_step: 'complete' }])

          const slid = await client.query(
            `UPDATE public."SilhouetteProfile"
             SET "build_slider" = 20, "revision" = "revision" + 1, "updated_at" = NOW()
             WHERE "id" = $1
             RETURNING "build_slider"`,
            [seeded.silhouetteProfileId]
          )
          expect(slid.rows).toEqual([{ build_slider: 20 }])

          // Decision 10 grants a full-access guardian raw DB-level write
          // capability over both tables (an accepted asymmetry with the
          // app routes, which stay self-scoped) — prove DELETE and INSERT
          // on behalf of the linked teen, not only UPDATE.
          const deletedOnboarding = await client.query(
            'DELETE FROM public."WardrobeOnboardingState" WHERE "id" = $1 RETURNING "id"',
            [seeded.onboardingStateId]
          )
          expect(deletedOnboarding.rows).toEqual([{ id: seeded.onboardingStateId }])

          const reinsertedOnboarding = await client.query(
            `INSERT INTO public."WardrobeOnboardingState" ("id", "user_id", "updated_at")
             VALUES ($1, $2, NOW())
             RETURNING "id"`,
            [`guardian-onboarding-${randomUUID()}`, seeded.teenId]
          )
          expect(reinsertedOnboarding.rows).toHaveLength(1)

          const deletedSilhouette = await client.query(
            'DELETE FROM public."SilhouetteProfile" WHERE "id" = $1 RETURNING "id"',
            [seeded.silhouetteProfileId]
          )
          expect(deletedSilhouette.rows).toEqual([{ id: seeded.silhouetteProfileId }])

          const reinsertedSilhouette = await client.query(
            `INSERT INTO public."SilhouetteProfile" ("id", "user_id", "updated_at")
             VALUES ($1, $2, NOW())
             RETURNING "id"`,
            [`guardian-silhouette-${randomUUID()}`, seeded.teenId]
          )
          expect(reinsertedSilhouette.rows).toHaveLength(1)
        }
      )
    }
  )

  scenarioTest(
    '4.4-DB-003 grants admins onboarding and silhouette reads',
    async ({ scenario: seeded }) => {
      await withRole(
        'authenticated',
        buildClaims(`admin-${randomUUID()}@example.com`, 'admin'),
        async (client) => {
          const onboarding = await client.query(
            'SELECT "id" FROM public."WardrobeOnboardingState" WHERE "user_id" = $1',
            [seeded.teenId]
          )
          expect(onboarding.rows).toEqual([{ id: seeded.onboardingStateId }])

          const silhouette = await client.query(
            'SELECT "id" FROM public."SilhouetteProfile" WHERE "user_id" = $1',
            [seeded.teenId]
          )
          expect(silhouette.rows).toEqual([{ id: seeded.silhouetteProfileId }])
        }
      )
    }
  )

  scenarioTest(
    '4.4-DB-003 blocks onboarding and silhouette access after a guardian consent is revoked',
    async ({ scenario: seeded }) => {
      const adminClient = await adminPool.connect()

      try {
        await adminClient.query(
          `UPDATE public."GuardianConsent"
           SET "revoked_at" = NOW(), "status" = 'revoked'
           WHERE "id" = $1`,
          [seeded.consentFullId]
        )
      } finally {
        adminClient.release()
      }

      await withRole(
        'authenticated',
        buildClaims(seeded.guardianFullAccessEmail, 'guardian'),
        async (client) => {
          const onboarding = await client.query(
            'SELECT "id" FROM public."WardrobeOnboardingState" WHERE "user_id" = $1',
            [seeded.teenId]
          )
          expect(onboarding.rows).toHaveLength(0)

          const silhouette = await client.query(
            'SELECT "id" FROM public."SilhouetteProfile" WHERE "user_id" = $1',
            [seeded.teenId]
          )
          expect(silhouette.rows).toHaveLength(0)

          const blockedUpdate = await client.query(
            `UPDATE public."WardrobeOnboardingState"
             SET "current_step" = 'complete', "updated_at" = NOW()
             WHERE "id" = $1
             RETURNING "id"`,
            [seeded.onboardingStateId]
          )
          expect(blockedUpdate.rows).toHaveLength(0)
        }
      )
    }
  )

  scenarioTest(
    '4.4-DB-003 blocks onboarding and silhouette access while a guardian consent is still pending',
    async ({ scenario: seeded }) => {
      const pendingConsentId = `consent-pending-${randomUUID()}`
      const adminClient = await adminPool.connect()

      try {
        await adminClient.query(
          `INSERT INTO public."GuardianConsent"
            ("id", "guardian_id", "teen_id", "consent_level", "status", "ip_address")
           VALUES ($1, $2, $3, 'full_access', 'pending', '127.0.0.1')`,
          [pendingConsentId, seeded.outsiderGuardianId, seeded.teenId]
        )
      } finally {
        adminClient.release()
      }

      try {
        await withRole(
          'authenticated',
          buildClaims(seeded.outsiderGuardianEmail, 'guardian'),
          async (client) => {
            const onboarding = await client.query(
              'SELECT "id" FROM public."WardrobeOnboardingState" WHERE "user_id" = $1',
              [seeded.teenId]
            )
            expect(onboarding.rows).toHaveLength(0)

            const silhouette = await client.query(
              'SELECT "id" FROM public."SilhouetteProfile" WHERE "user_id" = $1',
              [seeded.teenId]
            )
            expect(silhouette.rows).toHaveLength(0)
          }
        )
      } finally {
        const cleanupClient = await adminPool.connect()
        try {
          await cleanupClient.query(
            'DELETE FROM public."GuardianConsent" WHERE "id" = $1',
            [pendingConsentId]
          )
        } finally {
          cleanupClient.release()
        }
      }
    }
  )

  scenarioTest(
    '4.4-DB-003 blocks unrelated, unverified, spoofed, and anonymous onboarding/silhouette access',
    async ({ scenario: seeded }) => {
      await withRole(
        'authenticated',
        buildClaims(seeded.outsiderGuardianEmail, 'guardian'),
        async (client) => {
          const onboarding = await client.query(
            'SELECT "id" FROM public."WardrobeOnboardingState" WHERE "user_id" = $1',
            [seeded.teenId]
          )
          expect(onboarding.rows).toHaveLength(0)
        }
      )

      // An unverified email claim must never resolve to the teen identity.
      await withRole(
        'authenticated',
        {
          sub: randomUUID(),
          email: seeded.teenEmail,
          email_verified: false,
          role: 'authenticated',
          app_metadata: { role: 'guardian' },
        },
        async (client) => {
          const silhouette = await client.query(
            'SELECT "id" FROM public."SilhouetteProfile" WHERE "user_id" = $1',
            [seeded.teenId]
          )
          expect(silhouette.rows).toHaveLength(0)
        }
      )

      // Elevated role claims in user_metadata are attacker-controlled.
      await withRole(
        'authenticated',
        {
          sub: randomUUID(),
          email: `spoofed-${randomUUID()}@example.com`,
          email_verified: true,
          role: 'authenticated',
          user_metadata: { role: 'admin', email: seeded.teenEmail },
        },
        async (client) => {
          const onboarding = await client.query(
            'SELECT "id" FROM public."WardrobeOnboardingState" WHERE "user_id" = $1',
            [seeded.teenId]
          )
          expect(onboarding.rows).toHaveLength(0)
        }
      )

      // The anon role lacks table grants, so each refusal aborts its own
      // transaction and every table needs a separate session.
      await withRole('anon', null, async (client) => {
        await expect(
          client.query(
            'SELECT "id" FROM public."WardrobeOnboardingState" WHERE "user_id" = $1',
            [seeded.teenId]
          )
        ).rejects.toMatchObject({ code: '42501' })
      })

      await withRole('anon', null, async (client) => {
        await expect(
          client.query(
            'SELECT "id" FROM public."SilhouetteProfile" WHERE "user_id" = $1',
            [seeded.teenId]
          )
        ).rejects.toMatchObject({ code: '42501' })
      })
    }
  )

  scenarioTest(
    '4.4-DB-003 denies the Postgres service_role table access, matching GarmentItem',
    async ({ scenario: seeded }) => {
      // Guardian-shared tables are only granted to `authenticated`
      // (private/rls-policies.spec.ts's guardianSharedTables convention);
      // service_role has BYPASSRLS but no table grant here, so a backend
      // process must act through an `authenticated` session with an
      // elevated app-role claim, never the raw Postgres service role.
      await withRole('service_role', null, async (client) => {
        await expect(
          client.query(
            'SELECT "id" FROM public."WardrobeOnboardingState" WHERE "user_id" = $1',
            [seeded.teenId]
          )
        ).rejects.toMatchObject({ code: '42501' })
      })

      await withRole('service_role', null, async (client) => {
        await expect(
          client.query(
            'SELECT "id" FROM public."SilhouetteProfile" WHERE "user_id" = $1',
            [seeded.teenId]
          )
        ).rejects.toMatchObject({ code: '42501' })
      })
    }
  )

  scenarioTest(
    'keeps remaining guardian wardrobe access after one guardian revokes consent',
    async ({ scenario: seeded }) => {
      const adminClient = await adminPool.connect()

      try {
        await adminClient.query(
          `UPDATE public."GuardianConsent"
         SET "revoked_at" = NOW(), "status" = 'revoked'
         WHERE "id" = $1`,
          [seeded.consentReadOnlyId]
        )
      } finally {
        adminClient.release()
      }

      await withRole(
        'authenticated',
        buildClaims(seeded.guardianReadOnlyEmail, 'guardian'),
        async (client) => {
          const revokedGuardianRows = await client.query(
            'SELECT "id" FROM public."GarmentItem" WHERE "user_id" = $1',
            [seeded.teenId]
          )

          expect(revokedGuardianRows.rows).toHaveLength(0)
        }
      )

      await withRole(
        'authenticated',
        buildClaims(seeded.guardianFullAccessEmail, 'guardian'),
        async (client) => {
          const remainingGuardianRows = await client.query(
            'SELECT "id" FROM public."GarmentItem" WHERE "user_id" = $1',
            [seeded.teenId]
          )

          expect(remainingGuardianRows.rows).toEqual([{ id: seeded.garmentId }])

          const updateResult = await client.query(
            `UPDATE public."GarmentItem"
           SET "category" = $1, "updated_at" = NOW()
           WHERE "id" = $2
           RETURNING "category"`,
            ['bottom', seeded.garmentId]
          )

          expect(updateResult.rows).toEqual([{ category: 'bottom' }])
        }
      )
    }
  )

  scenarioTest(
    'keeps social tables self-scoped until community sharing semantics exist',
    async ({ scenario: seeded }) => {
      await withRole(
        'authenticated',
        buildClaims(seeded.teenEmail, 'teen'),
        async (client) => {
          const ownPosts = await client.query(
            'SELECT "id" FROM public."LookbookPost" WHERE "user_id" = $1',
            [seeded.teenId]
          )

          expect(ownPosts.rows).toHaveLength(1)
        }
      )

      await withRole(
        'authenticated',
        buildClaims(seeded.guardianFullAccessEmail, 'guardian'),
        async (client) => {
          const teenPosts = await client.query(
            'SELECT "id" FROM public."LookbookPost" WHERE "user_id" = $1',
            [seeded.teenId]
          )

          expect(teenPosts.rows).toHaveLength(0)
        }
      )
    }
  )

  scenarioTest(
    'keeps saved locations self-scoped for guardians while allowing admin access',
    async ({ scenario: seeded }) => {
      await withRole(
        'authenticated',
        buildClaims(seeded.guardianFullAccessEmail, 'guardian'),
        async (client) => {
          const teenLocations = await client.query(
            'SELECT "id" FROM public."SavedLocation" WHERE "user_id" = $1',
            [seeded.teenId]
          )

          expect(teenLocations.rows).toHaveLength(0)
        }
      )

      await withRole(
        'authenticated',
        buildClaims(`admin-${randomUUID()}@example.com`, 'admin'),
        async (client) => {
          const teenLocations = await client.query(
            'SELECT "id" FROM public."SavedLocation" WHERE "user_id" = $1',
            [seeded.teenId]
          )

          expect(teenLocations.rows).toEqual([{ id: seeded.savedLocationId }])
        }
      )
    }
  )

  scenarioTest(
    'allows owners to perform CRUD on alert rules',
    async ({ scenario: seeded }) => {
      await withRole(
        'authenticated',
        buildClaims(seeded.teenEmail, 'teen'),
        async (client) => {
          const alertRules = await client.query<{
            id: string
            threshold: number
          }>(
            `SELECT "id", "threshold"
           FROM public."AlertRule"
           WHERE "id" = ANY($1::text[])`,
            [[seeded.alertRuleId, seeded.otherAlertRuleId]]
          )

          expect(alertRules.rows).toEqual([{ id: seeded.alertRuleId, threshold: 8 }])

          const updatedRule = await client.query(
            `UPDATE public."AlertRule"
           SET "threshold" = 10, "updated_at" = NOW()
           WHERE "id" = $1
           RETURNING "threshold"`,
            [seeded.alertRuleId]
          )
          expect(updatedRule.rows).toEqual([{ threshold: 10 }])

          const deleted = await client.query(
            'DELETE FROM public."AlertRule" WHERE "id" = $1 RETURNING "id"',
            [seeded.alertRuleId]
          )
          expect(deleted.rows).toEqual([{ id: seeded.alertRuleId }])

          const insertedRule = await client.query(
            `INSERT INTO public."AlertRule"
            ("id", "user_id", "rule_type", "threshold", "updated_at")
           VALUES ($1, $2, 'precipitation', 0.5, NOW())
           RETURNING "id"`,
            [seeded.alertRuleId, seeded.teenId]
          )
          expect(insertedRule.rows).toEqual([{ id: seeded.alertRuleId }])
        }
      )
    }
  )

  scenarioTest(
    'allows owners to perform CRUD on notification preferences',
    async ({ scenario: seeded }) => {
      await withRole(
        'authenticated',
        buildClaims(seeded.teenEmail, 'teen'),
        async (client) => {
          const preferences = await client.query<{
            id: string
            push_enabled: boolean
          }>(
            `SELECT "id", "push_enabled"
             FROM public."NotificationPreference"
             WHERE "id" = ANY($1::text[])`,
            [[seeded.notificationPreferenceId, seeded.otherNotificationPreferenceId]]
          )
          expect(preferences.rows).toEqual([
            { id: seeded.notificationPreferenceId, push_enabled: true },
          ])

          const updated = await client.query(
            `UPDATE public."NotificationPreference"
             SET "push_enabled" = FALSE, "updated_at" = NOW()
             WHERE "id" = $1
             RETURNING "push_enabled"`,
            [seeded.notificationPreferenceId]
          )
          expect(updated.rows).toEqual([{ push_enabled: false }])

          const deleted = await client.query(
            'DELETE FROM public."NotificationPreference" WHERE "id" = $1 RETURNING "id"',
            [seeded.notificationPreferenceId]
          )
          expect(deleted.rows).toEqual([{ id: seeded.notificationPreferenceId }])

          const insertedPreference = await client.query(
            `INSERT INTO public."NotificationPreference"
            ("id", "user_id", "push_enabled", "updated_at")
           VALUES ($1, $2, TRUE, NOW())
           RETURNING "id"`,
            [seeded.notificationPreferenceId, seeded.teenId]
          )
          expect(insertedPreference.rows).toEqual([
            { id: seeded.notificationPreferenceId },
          ])
        }
      )
    }
  )

  scenarioTest(
    'allows owners to perform CRUD on push tokens',
    async ({ scenario: seeded }) => {
      await withRole(
        'authenticated',
        buildClaims(seeded.teenEmail, 'teen'),
        async (client) => {
          const tokens = await client.query<{ id: string; platform: string }>(
            `SELECT "id", "platform"
             FROM public."PushToken"
             WHERE "id" = ANY($1::text[])`,
            [[seeded.pushTokenId, seeded.otherPushTokenId]]
          )
          expect(tokens.rows).toEqual([{ id: seeded.pushTokenId, platform: 'ios' }])

          const updated = await client.query(
            `UPDATE public."PushToken"
             SET "platform" = 'android', "updated_at" = NOW()
             WHERE "id" = $1
             RETURNING "platform"`,
            [seeded.pushTokenId]
          )
          expect(updated.rows).toEqual([{ platform: 'android' }])

          const deleted = await client.query(
            'DELETE FROM public."PushToken" WHERE "id" = $1 RETURNING "id"',
            [seeded.pushTokenId]
          )
          expect(deleted.rows).toEqual([{ id: seeded.pushTokenId }])

          const insertedToken = await client.query(
            `INSERT INTO public."PushToken"
            ("id", "user_id", "token", "platform", "updated_at")
           VALUES ($1, $2, $3, 'ios', NOW())
           RETURNING "id"`,
            [seeded.pushTokenId, seeded.teenId, seeded.pushToken]
          )
          expect(insertedToken.rows).toEqual([{ id: seeded.pushTokenId }])
        }
      )
    }
  )

  scenarioTest(
    'exposes only owned and global event envelopes to authenticated users',
    async ({ scenario: seeded }) => {
      await withRole(
        'authenticated',
        buildClaims(seeded.teenEmail, 'teen'),
        async (client) => {
          const events = await client.query<{ id: string }>(
            `SELECT "id"
           FROM public."EventEnvelope"
           WHERE "id" = ANY($1::text[])`,
            [
              [
                seeded.eventEnvelopeId,
                seeded.otherEventEnvelopeId,
                seeded.globalEventEnvelopeId,
              ],
            ]
          )

          expect(new Set(events.rows.map((row) => row.id))).toEqual(
            new Set([seeded.eventEnvelopeId, seeded.globalEventEnvelopeId])
          )
        }
      )
    }
  )

  scenarioTest(
    'keeps alert settings, push tokens, and user events hidden from other users',
    async ({ scenario: seeded }) => {
      await withRole(
        'authenticated',
        buildClaims(seeded.teenEmail, 'teen'),
        async (client) => {
          const otherRules = await client.query(
            'SELECT "id" FROM public."AlertRule" WHERE "user_id" = $1',
            [seeded.otherTeenId]
          )
          expect(otherRules.rows).toHaveLength(0)

          const otherPreferences = await client.query(
            'SELECT "id" FROM public."NotificationPreference" WHERE "user_id" = $1',
            [seeded.otherTeenId]
          )
          expect(otherPreferences.rows).toHaveLength(0)

          const otherTokens = await client.query(
            'SELECT "id" FROM public."PushToken" WHERE "user_id" = $1',
            [seeded.otherTeenId]
          )
          expect(otherTokens.rows).toHaveLength(0)

          const otherEvents = await client.query(
            'SELECT "id" FROM public."EventEnvelope" WHERE "user_id" = $1',
            [seeded.otherTeenId]
          )
          expect(otherEvents.rows).toHaveLength(0)

          const updatedRule = await client.query(
            `UPDATE public."AlertRule"
           SET "threshold" = 99, "updated_at" = NOW()
           WHERE "id" = $1
           RETURNING "id"`,
            [seeded.otherAlertRuleId]
          )
          expect(updatedRule.rows).toHaveLength(0)

          const deletedToken = await client.query(
            'DELETE FROM public."PushToken" WHERE "id" = $1 RETURNING "id"',
            [seeded.otherPushTokenId]
          )
          expect(deletedToken.rows).toHaveLength(0)
        }
      )
    }
  )

  scenarioTest(
    'rejects cross-account alert rule inserts',
    async ({ scenario: seeded }) => {
      await withRole(
        'authenticated',
        buildClaims(seeded.teenEmail, 'teen'),
        async (client) => {
          await expect(
            client.query(
              `INSERT INTO public."AlertRule"
              ("id", "user_id", "rule_type", "threshold", "updated_at")
             VALUES ($1, $2, 'precipitation', 0.5, NOW())`,
              [`cross-alert-rule-${randomUUID()}`, seeded.otherTeenId]
            )
          ).rejects.toMatchObject({ code: '42501' })
        }
      )
    }
  )

  scenarioTest(
    'rejects cross-account notification preference inserts',
    async ({ scenario: seeded }) => {
      await withRole(
        'authenticated',
        buildClaims(seeded.teenEmail, 'teen'),
        async (client) => {
          await expect(
            client.query(
              `INSERT INTO public."NotificationPreference"
              ("id", "user_id", "push_enabled", "updated_at")
             VALUES ($1, $2, TRUE, NOW())`,
              [`cross-notification-preference-${randomUUID()}`, seeded.guardianReadOnlyId]
            )
          ).rejects.toMatchObject({ code: '42501' })
        }
      )
    }
  )

  scenarioTest(
    'rejects cross-account push token inserts',
    async ({ scenario: seeded }) => {
      await withRole(
        'authenticated',
        buildClaims(seeded.teenEmail, 'teen'),
        async (client) => {
          await expect(
            client.query(
              `INSERT INTO public."PushToken"
              ("id", "user_id", "token", "platform", "updated_at")
             VALUES ($1, $2, $3, 'ios', NOW())`,
              [
                `cross-push-token-${randomUUID()}`,
                seeded.otherTeenId,
                `ExponentPushToken[cross-${randomUUID()}]`,
              ]
            )
          ).rejects.toMatchObject({ code: '42501' })
        }
      )
    }
  )

  scenarioTest(
    'does not extend full guardian access to private alert delivery records',
    async ({ scenario: seeded }) => {
      await withRole(
        'authenticated',
        buildClaims(seeded.guardianFullAccessEmail, 'guardian'),
        async (client) => {
          for (const tableName of [
            'AlertRule',
            'NotificationPreference',
            'PushToken',
          ] as const) {
            const rows = await client.query(
              `SELECT "id" FROM public."${tableName}" WHERE "user_id" = $1`,
              [seeded.teenId]
            )
            expect(rows.rows).toHaveLength(0)
          }

          const privateEvents = await client.query(
            'SELECT "id" FROM public."EventEnvelope" WHERE "user_id" = $1',
            [seeded.teenId]
          )
          expect(privateEvents.rows).toHaveLength(0)

          const globalEvents = await client.query(
            'SELECT "id" FROM public."EventEnvelope" WHERE "id" = $1',
            [seeded.globalEventEnvelopeId]
          )
          expect(globalEvents.rows).toEqual([{ id: seeded.globalEventEnvelopeId }])
        }
      )
    }
  )

  scenarioTest(
    'allows administrators to inspect alert settings and delivery records',
    async ({ scenario: seeded }) => {
      await withRole(
        'authenticated',
        buildClaims(`admin-${randomUUID()}@example.com`, 'admin'),
        async (client) => {
          for (const tableName of [
            'AlertRule',
            'NotificationPreference',
            'PushToken',
          ] as const) {
            const rows = await client.query(
              `SELECT "id" FROM public."${tableName}"
             WHERE "user_id" = ANY($1::text[])`,
              [[seeded.teenId, seeded.otherTeenId]]
            )
            expect(rows.rows).toHaveLength(2)
          }

          const events = await client.query(
            `SELECT "id" FROM public."EventEnvelope"
           WHERE "id" = ANY($1::text[])`,
            [
              [
                seeded.eventEnvelopeId,
                seeded.otherEventEnvelopeId,
                seeded.globalEventEnvelopeId,
              ],
            ]
          )
          expect(events.rows).toHaveLength(3)

          const updatedRule = await client.query(
            `UPDATE public."AlertRule"
           SET "enabled" = FALSE, "updated_at" = NOW()
           WHERE "id" = $1
           RETURNING "enabled"`,
            [seeded.otherAlertRuleId]
          )
          expect(updatedRule.rows).toEqual([{ enabled: false }])
        }
      )
    }
  )

  scenarioTest(
    'denies teens from reading another teen wardrobe',
    async ({ scenario: seeded }) => {
      await withRole(
        'authenticated',
        buildClaims(seeded.teenEmail, 'teen'),
        async (guardedClient) => {
          const otherTeenRows = await guardedClient.query(
            'SELECT "id" FROM public."GarmentItem" WHERE "user_id" = $1',
            [seeded.otherTeenId]
          )

          expect(otherTeenRows.rows).toHaveLength(0)

          const otherSavedLocationRows = await guardedClient.query(
            'SELECT "id" FROM public."SavedLocation" WHERE "user_id" = $1',
            [seeded.otherTeenId]
          )

          expect(otherSavedLocationRows.rows).toHaveLength(0)

          const otherSavedLocationUpdate = await guardedClient.query(
            `UPDATE public."SavedLocation"
           SET "label" = $1, "updated_at" = NOW()
           WHERE "id" = $2
           RETURNING "id"`,
            ['Blocked update', seeded.otherSavedLocationId]
          )

          expect(otherSavedLocationUpdate.rows).toHaveLength(0)

          const otherSavedLocationDelete = await guardedClient.query(
            'DELETE FROM public."SavedLocation" WHERE "id" = $1 RETURNING "id"',
            [seeded.otherSavedLocationId]
          )

          expect(otherSavedLocationDelete.rows).toHaveLength(0)
        }
      )
    }
  )

  scenarioTest(
    'does not trust unverified email claims for cross-account access',
    async ({ scenario: seeded }) => {
      await withRole(
        'authenticated',
        {
          sub: randomUUID(),
          email: seeded.teenEmail,
          email_verified: false,
          role: 'authenticated',
          app_metadata: {
            role: 'guardian',
          },
        },
        async (client) => {
          const garmentRows = await client.query(
            'SELECT "id" FROM public."GarmentItem" WHERE "user_id" = $1',
            [seeded.teenId]
          )

          expect(garmentRows.rows).toHaveLength(0)
        }
      )
    }
  )

  scenarioTest(
    'denies unrelated guardians and anonymous actors from teen wardrobe data',
    async ({ scenario: seeded }) => {
      await withRole(
        'authenticated',
        buildClaims(seeded.outsiderGuardianEmail, 'guardian'),
        async (client) => {
          const garmentRows = await client.query(
            'SELECT "id" FROM public."GarmentItem" WHERE "user_id" = $1',
            [seeded.teenId]
          )

          expect(garmentRows.rows).toHaveLength(0)
        }
      )

      await withRole('anon', null, async (client) => {
        await expect(
          client.query('SELECT "id" FROM public."GarmentItem" WHERE "user_id" = $1', [
            seeded.teenId,
          ])
        ).rejects.toMatchObject({
          code: '42501',
        })
      })
    }
  )

  scenarioTest(
    'does not grant access from user_metadata identity or role claims',
    async ({ scenario: seeded }) => {
      await withRole(
        'authenticated',
        {
          sub: randomUUID(),
          email: seeded.outsiderGuardianEmail,
          email_verified: true,
          role: 'authenticated',
          app_metadata: {
            role: 'guardian',
          },
          user_metadata: {
            app_user_id: seeded.teenId,
            app_role: 'admin',
            role: 'admin',
          },
        },
        async (client) => {
          const garmentRows = await client.query(
            'SELECT "id" FROM public."GarmentItem" WHERE "user_id" = $1',
            [seeded.teenId]
          )

          expect(garmentRows.rows).toHaveLength(0)
        }
      )
    }
  )

  scenarioTest(
    'blocks teen self access after the last guardian consent is revoked',
    async ({ scenario: seeded }) => {
      const client = await adminPool.connect()

      try {
        await client.query('BEGIN')
        await client.query(
          `UPDATE public."GuardianConsent"
         SET "revoked_at" = NOW(), "status" = 'revoked'
         WHERE "teen_id" = $1`,
          [seeded.teenId]
        )
        await client.query(
          `UPDATE public."UserProfile"
         SET "preferences" = $2::jsonb, "updated_at" = NOW()
         WHERE "user_id" = $1`,
          [
            seeded.teenId,
            JSON.stringify({
              compliance: {
                accountStatus: 'pending_guardian_consent',
                guardianConsentRequired: true,
              },
            }),
          ]
        )
        await client.query('COMMIT')
      } catch (error) {
        await client.query('ROLLBACK')
        throw error
      } finally {
        client.release()
      }

      await withRole(
        'authenticated',
        buildClaims(seeded.teenEmail, 'teen'),
        async (guardedClient) => {
          const garmentRows = await guardedClient.query(
            'SELECT "id" FROM public."GarmentItem" WHERE "user_id" = $1',
            [seeded.teenId]
          )

          expect(garmentRows.rows).toHaveLength(0)

          const updateResult = await guardedClient.query(
            `UPDATE public."GarmentItem"
           SET "category" = $1, "updated_at" = NOW()
           WHERE "id" = $2
           RETURNING "id"`,
            ['accessory', seeded.garmentId]
          )

          expect(updateResult.rowCount).toBe(0)
        }
      )
    }
  )

  scenarioTest(
    'does not allow authenticated callers to execute the guardian-consent helper directly',
    async ({ scenario: seeded }) => {
      await withRole(
        'authenticated',
        buildClaims(seeded.teenEmail, 'teen'),
        async (client) => {
          await expect(
            client.query('SELECT private.user_requires_guardian_consent($1)', [
              seeded.teenId,
            ])
          ).rejects.toMatchObject({
            code: '42501',
          })
        }
      )
    }
  )

  scenarioTest(
    'allows admin claims to inspect and update teen wardrobe rows without service role bypass',
    async ({ scenario: seeded }) => {
      await withRole(
        'authenticated',
        buildClaims(`admin-${randomUUID()}@example.com`, 'admin'),
        async (client) => {
          const garmentRows = await client.query(
            'SELECT "id" FROM public."GarmentItem" WHERE "user_id" = $1',
            [seeded.teenId]
          )

          expect(garmentRows.rows).toHaveLength(1)

          const updateResult = await client.query(
            `UPDATE public."GarmentItem"
           SET "category" = $1, "updated_at" = NOW()
           WHERE "id" = $2
           RETURNING "category"`,
            ['accessory', seeded.garmentId]
          )

          expect(updateResult.rows).toEqual([{ category: 'accessory' }])
        }
      )
    }
  )

  scenarioTest(
    'enforces telemetry RLS policies for authenticated users and the service role',
    async ({ scenario: seeded }) => {
      // 1. Authenticated user CAN insert their own telemetry
      await withRole(
        'authenticated',
        buildClaims(seeded.teenEmail, 'teen'),
        async (client) => {
          const id = randomUUID()
          const result = await client.query(
            `INSERT INTO public."telemetry_events" ("id", "user_id", "event_type", "properties")
           VALUES ($1, $2, 'profile_completed', '{"age": 16}'::jsonb)
           RETURNING "id"`,
            [id, seeded.teenId]
          )
          expect(result.rowCount).toBe(1)
        }
      )

      // 2. Authenticated user CANNOT insert telemetry with null user_id (anonymous/system record)
      await withRole(
        'authenticated',
        buildClaims(seeded.teenEmail, 'teen'),
        async (client) => {
          const id = randomUUID()
          await expect(
            client.query(
              `INSERT INTO public."telemetry_events" ("id", "user_id", "event_type", "properties")
             VALUES ($1, NULL, 'forecast_viewed', '{"status": "success"}'::jsonb)`,
              [id]
            )
          ).rejects.toThrow()
        }
      )

      // 3. Service role CAN insert anonymous telemetry (null user_id)
      await withRole('service_role', {}, async (client) => {
        const id = randomUUID()
        const result = await client.query(
          `INSERT INTO public."telemetry_events" ("id", "user_id", "event_type", "properties")
           VALUES ($1, NULL, 'forecast_viewed', '{"status": "success"}'::jsonb)
           RETURNING "id"`,
          [id]
        )
        expect(result.rowCount).toBe(1)
      })
    }
  )

  scenarioTest(
    '5.1-DB-001 lets the owner read, update, and delete their own commerce preference',
    async ({ scenario: seeded }) => {
      await withRole(
        'authenticated',
        buildClaims(seeded.teenEmail, 'teen'),
        async (client) => {
          const ownRows = await client.query(
            'SELECT "id" FROM public."CommercePreference" WHERE "user_id" = $1',
            [seeded.teenId]
          )
          expect(ownRows.rows).toEqual([{ id: seeded.commercePreferenceId }])

          const updated = await client.query(
            `UPDATE public."CommercePreference"
               SET "affiliate_ctas_enabled" = FALSE, "updated_at" = NOW()
             WHERE "id" = $1
             RETURNING "affiliate_ctas_enabled"`,
            [seeded.commercePreferenceId]
          )
          expect(updated.rows).toEqual([{ affiliate_ctas_enabled: false }])

          const deleted = await client.query(
            'DELETE FROM public."CommercePreference" WHERE "id" = $1',
            [seeded.commercePreferenceId]
          )
          expect(deleted.rowCount).toBe(1)
        }
      )
    }
  )

  scenarioTest(
    '5.1-DB-002 denies BOTH guardian levels access to commerce preference and click rows',
    async ({ scenario: seeded }) => {
      // The point of the test. Every other wardrobe-adjacent table in this
      // schema is guardian-shared, so "guardians can see it" is the default
      // assumption a reader brings. Story 5.1 deliberately breaks that: a
      // purchase-intent trail is not something this story has a mandate to
      // expose, so read-only AND full-access consent both resolve to nothing.
      for (const guardianEmail of [
        seeded.guardianReadOnlyEmail,
        seeded.guardianFullAccessEmail,
      ]) {
        await withRole(
          'authenticated',
          buildClaims(guardianEmail, 'guardian'),
          async (client) => {
            const preferences = await client.query(
              'SELECT "id" FROM public."CommercePreference" WHERE "user_id" = $1',
              [seeded.teenId]
            )
            expect(preferences.rows).toHaveLength(0)

            const clicks = await client.query(
              'SELECT "id" FROM public."AffiliateClick" WHERE "user_id" = $1',
              [seeded.teenId]
            )
            expect(clicks.rows).toHaveLength(0)

            // A guardian must not be able to write one either. RLS makes this a
            // zero-row UPDATE rather than an error, which is why the assertion
            // is on rowCount and not on a rejection.
            const attemptedUpdate = await client.query(
              `UPDATE public."CommercePreference"
                 SET "affiliate_ctas_enabled" = FALSE, "updated_at" = NOW()
               WHERE "user_id" = $1`,
              [seeded.teenId]
            )
            expect(attemptedUpdate.rowCount).toBe(0)
          }
        )
      }
    }
  )

  scenarioTest(
    '5.1-DB-003 denies unrelated authenticated users and the anon role',
    async ({ scenario: seeded }) => {
      await withRole(
        'authenticated',
        buildClaims(seeded.otherTeenEmail, 'teen'),
        async (client) => {
          const preferences = await client.query(
            'SELECT "id" FROM public."CommercePreference" WHERE "user_id" = $1',
            [seeded.teenId]
          )
          expect(preferences.rows).toHaveLength(0)

          const clicks = await client.query(
            'SELECT "id" FROM public."AffiliateClick" WHERE "user_id" = $1',
            [seeded.teenId]
          )
          expect(clicks.rows).toHaveLength(0)
        }
      )

      await withRole('anon', null, async (client) => {
        await expect(
          client.query(
            'SELECT "id" FROM public."CommercePreference" WHERE "user_id" = $1',
            [seeded.teenId]
          )
        ).rejects.toMatchObject({ code: '42501' })
      })
    }
  )

  scenarioTest(
    '5.1-DB-004 grants an admin actor access to commerce rows',
    async ({ scenario: seeded }) => {
      await withRole(
        'authenticated',
        buildClaims(`admin-${randomUUID()}@example.com`, 'admin'),
        async (client) => {
          const preferences = await client.query(
            'SELECT "id" FROM public."CommercePreference" WHERE "user_id" = $1',
            [seeded.teenId]
          )
          expect(preferences.rows).toEqual([{ id: seeded.commercePreferenceId }])

          const clicks = await client.query(
            'SELECT "id" FROM public."AffiliateClick" WHERE "user_id" = $1',
            [seeded.teenId]
          )
          expect(clicks.rows).toEqual([{ id: seeded.affiliateClickId }])
        }
      )
    }
  )

  scenarioTest(
    '5.1-DB-005 denies a spoofed user_metadata role escalation on commerce rows',
    async ({ scenario: seeded }) => {
      // app_metadata is server-controlled; user_metadata is user-writable. A
      // claim set that puts "admin" only in user_metadata must not be honoured,
      // or the owner-only guarantee above is worth nothing.
      const spoofedClaims = {
        sub: randomUUID(),
        email: seeded.otherTeenEmail,
        email_verified: true,
        role: 'authenticated',
        app_metadata: { role: 'teen' },
        user_metadata: { role: 'admin' },
      }

      await withRole('authenticated', spoofedClaims, async (client) => {
        const preferences = await client.query(
          'SELECT "id" FROM public."CommercePreference" WHERE "user_id" = $1',
          [seeded.teenId]
        )
        expect(preferences.rows).toHaveLength(0)
      })
    }
  )

  scenarioTest(
    '5.1-DB-006 denies an unverified email claim access to commerce rows',
    async ({ scenario: seeded }) => {
      const unverifiedClaims = {
        sub: randomUUID(),
        email: seeded.teenEmail,
        email_verified: false,
        role: 'authenticated',
        app_metadata: { role: 'teen' },
      }

      await withRole('authenticated', unverifiedClaims, async (client) => {
        const preferences = await client.query(
          'SELECT "id" FROM public."CommercePreference" WHERE "user_id" = $1',
          [seeded.teenId]
        )
        expect(preferences.rows).toHaveLength(0)
      })
    }
  )

  it('keeps the commerce catalog and conversion ledger unreachable by clients', async () => {
    // CommercePartner, AffiliateOffer, and AffiliateConversion carry no user_id
    // at all, so there is nothing for a row-level policy to key on. They are
    // instead protected by having no policies and no grants: the catalog is
    // operator-managed and conversions are written only by the
    // machine-to-machine webhook, so no client should ever reach either.
    const privateTables = [
      'CommercePartner',
      'AffiliateOffer',
      'AffiliateConversion',
    ] as const
    const client = await adminPool.connect()

    try {
      const rlsState = await client.query<{
        table_name: string
        rls_enabled: boolean
      }>(
        `SELECT c.relname AS table_name, c.relrowsecurity AS rls_enabled
         FROM pg_class AS c
         INNER JOIN pg_namespace AS n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public'
           AND c.relname = ANY($1::text[])`,
        [privateTables]
      )

      expect(rlsState.rows).toHaveLength(privateTables.length)
      expect(rlsState.rows.every((row) => row.rls_enabled)).toBe(true)

      const policies = await client.query(
        `SELECT policyname
         FROM pg_policies
         WHERE schemaname = 'public'
           AND tablename = ANY($1::text[])`,
        [privateTables]
      )
      expect(policies.rows).toEqual([])

      const clientGrants = await client.query(
        `SELECT grantee, table_name, privilege_type
         FROM information_schema.role_table_grants
         WHERE table_schema = 'public'
           AND table_name = ANY($1::text[])
           AND grantee = ANY($2::text[])`,
        [privateTables, ['anon', 'authenticated']]
      )
      expect(clientGrants.rows).toEqual([])
    } finally {
      client.release()
    }
  })

  scenarioTest(
    '5.1-DB-007 rejects a direct authenticated read of the catalog and conversions',
    async ({ scenario: seeded }) => {
      // The grant check above proves the permission state; this proves the
      // observable behaviour, which is what an attacker would actually hit.
      for (const table of ['CommercePartner', 'AffiliateOffer', 'AffiliateConversion']) {
        await withRole(
          'authenticated',
          buildClaims(seeded.teenEmail, 'teen'),
          async (client) => {
            await expect(
              client.query(`SELECT "id" FROM public."${table}" LIMIT 1`)
            ).rejects.toMatchObject({ code: '42501' })
          }
        )
      }
    }
  )
})

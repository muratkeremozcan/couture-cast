import { randomUUID } from 'node:crypto'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
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
] as const

const selfOnlyTables = [
  'LookbookPost',
  'EngagementEvent',
  'SavedLocation',
  'AlertRule',
  'NotificationPreference',
  'PushToken',
] as const

const ownerOrGlobalReadTables = ['EventEnvelope'] as const

const adminPool = new Pool({
  connectionString: databaseUrl,
  max: 4,
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
}

let scenario: SeededScenario | undefined

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
  role: 'authenticated' | 'anon',
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
    await client.query('DELETE FROM public."OutfitRecommendation" WHERE "id" = $1', [
      seeded.outfitId,
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

describe.sequential('guardian-aware RLS policies', () => {
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

  afterEach(async () => {
    try {
      await cleanupScenario(scenario)
    } finally {
      scenario = undefined
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
        new Set(['authenticated_read_own_telemetry', 'authenticated_insert_telemetry'])
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

  it('allows teens to read and update their own wardrobe-scoped rows', async () => {
    const seeded = (scenario = await seedScenario())

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
  })

  it('lets linked guardians read teen wardrobe data but blocks read-only mutations', async () => {
    const seeded = (scenario = await seedScenario())

    await withRole(
      'authenticated',
      buildClaims(seeded.guardianReadOnlyEmail, 'guardian'),
      async (client) => {
        const garmentRows = await client.query<{
          id: string
        }>('SELECT "id" FROM public."GarmentItem" WHERE "user_id" = $1', [seeded.teenId])

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
          ['coat', seeded.garmentId]
        )

        expect(updateResult.rowCount).toBe(0)
      }
    )
  })

  it('grants wardrobe access from a single active guardian consent row', async () => {
    const seeded = (scenario = await seedScenario())

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
  })

  it('lets full-access guardians mutate linked teen wardrobe rows', async () => {
    const seeded = (scenario = await seedScenario())

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
          ['jacket', seeded.garmentId]
        )

        expect(updateResult.rows).toEqual([{ category: 'jacket' }])

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
  })

  it('keeps remaining guardian wardrobe access after one guardian revokes consent', async () => {
    const seeded = (scenario = await seedScenario())

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
          ['remaining-guardian-reviewed', seeded.garmentId]
        )

        expect(updateResult.rows).toEqual([{ category: 'remaining-guardian-reviewed' }])
      }
    )
  })

  it('keeps social tables self-scoped until community sharing semantics exist', async () => {
    const seeded = (scenario = await seedScenario())

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
  })

  it('keeps saved locations self-scoped for guardians while allowing admin access', async () => {
    const seeded = (scenario = await seedScenario())

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
  })

  it('allows owners to perform CRUD on alert settings and push tokens', async () => {
    const seeded = (scenario = await seedScenario())

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

        const notificationPreferences = await client.query<{
          id: string
          push_enabled: boolean
        }>(
          `SELECT "id", "push_enabled"
           FROM public."NotificationPreference"
           WHERE "id" = ANY($1::text[])`,
          [[seeded.notificationPreferenceId, seeded.otherNotificationPreferenceId]]
        )

        expect(notificationPreferences.rows).toEqual([
          { id: seeded.notificationPreferenceId, push_enabled: true },
        ])

        const pushTokens = await client.query<{
          id: string
          platform: string
        }>(
          `SELECT "id", "platform"
           FROM public."PushToken"
           WHERE "id" = ANY($1::text[])`,
          [[seeded.pushTokenId, seeded.otherPushTokenId]]
        )

        expect(pushTokens.rows).toEqual([{ id: seeded.pushTokenId, platform: 'ios' }])

        const updatedRule = await client.query(
          `UPDATE public."AlertRule"
           SET "threshold" = 10, "updated_at" = NOW()
           WHERE "id" = $1
           RETURNING "threshold"`,
          [seeded.alertRuleId]
        )
        expect(updatedRule.rows).toEqual([{ threshold: 10 }])

        const updatedPreference = await client.query(
          `UPDATE public."NotificationPreference"
           SET "push_enabled" = FALSE, "updated_at" = NOW()
           WHERE "id" = $1
           RETURNING "push_enabled"`,
          [seeded.notificationPreferenceId]
        )
        expect(updatedPreference.rows).toEqual([{ push_enabled: false }])

        const updatedToken = await client.query(
          `UPDATE public."PushToken"
           SET "platform" = 'android', "updated_at" = NOW()
           WHERE "id" = $1
           RETURNING "platform"`,
          [seeded.pushTokenId]
        )
        expect(updatedToken.rows).toEqual([{ platform: 'android' }])

        for (const [tableName, id] of [
          ['AlertRule', seeded.alertRuleId],
          ['NotificationPreference', seeded.notificationPreferenceId],
          ['PushToken', seeded.pushTokenId],
        ] as const) {
          const deleted = await client.query(
            `DELETE FROM public."${tableName}" WHERE "id" = $1 RETURNING "id"`,
            [id]
          )
          expect(deleted.rows).toEqual([{ id }])
        }

        const insertedRule = await client.query(
          `INSERT INTO public."AlertRule"
            ("id", "user_id", "rule_type", "threshold", "updated_at")
           VALUES ($1, $2, 'precipitation', 0.5, NOW())
           RETURNING "id"`,
          [seeded.alertRuleId, seeded.teenId]
        )
        expect(insertedRule.rows).toEqual([{ id: seeded.alertRuleId }])

        const insertedPreference = await client.query(
          `INSERT INTO public."NotificationPreference"
            ("id", "user_id", "push_enabled", "updated_at")
           VALUES ($1, $2, TRUE, NOW())
           RETURNING "id"`,
          [seeded.notificationPreferenceId, seeded.teenId]
        )
        expect(insertedPreference.rows).toEqual([{ id: seeded.notificationPreferenceId }])

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
  })

  it('exposes only owned and global event envelopes to authenticated users', async () => {
    const seeded = (scenario = await seedScenario())

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
  })

  it('keeps alert settings, push tokens, and user events hidden from other users', async () => {
    const seeded = (scenario = await seedScenario())

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
  })

  it('rejects cross-account alert rule inserts', async () => {
    const seeded = (scenario = await seedScenario())

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
  })

  it('rejects cross-account notification preference inserts', async () => {
    const seeded = (scenario = await seedScenario())

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
  })

  it('rejects cross-account push token inserts', async () => {
    const seeded = (scenario = await seedScenario())

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
  })

  it('does not extend full guardian access to private alert delivery records', async () => {
    const seeded = (scenario = await seedScenario())

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
  })

  it('allows administrators to inspect alert settings and delivery records', async () => {
    const seeded = (scenario = await seedScenario())

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
  })

  it('denies teens from reading another teen wardrobe', async () => {
    const seeded = (scenario = await seedScenario())

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
  })

  it('does not trust unverified email claims for cross-account access', async () => {
    const seeded = (scenario = await seedScenario())

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
  })

  it('denies unrelated guardians and anonymous actors from teen wardrobe data', async () => {
    const seeded = (scenario = await seedScenario())

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
  })

  it('does not grant access from user_metadata identity or role claims', async () => {
    const seeded = (scenario = await seedScenario())

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
  })

  it('blocks teen self access after the last guardian consent is revoked', async () => {
    const seeded = (scenario = await seedScenario())

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
          ['restored-without-consent', seeded.garmentId]
        )

        expect(updateResult.rowCount).toBe(0)
      }
    )
  })

  it('does not allow authenticated callers to execute the guardian-consent helper directly', async () => {
    const seeded = (scenario = await seedScenario())

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
  })

  it('allows admin claims to inspect and update teen wardrobe rows without service role bypass', async () => {
    const seeded = (scenario = await seedScenario())

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
          ['admin-reviewed', seeded.garmentId]
        )

        expect(updateResult.rows).toEqual([{ category: 'admin-reviewed' }])
      }
    )
  })
})

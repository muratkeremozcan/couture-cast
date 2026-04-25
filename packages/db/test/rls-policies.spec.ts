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

const selfOnlyTables = ['LookbookPost', 'EngagementEvent'] as const

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
    await client.query('DELETE FROM public."EngagementEvent" WHERE "id" = $1', [
      seeded.eventId,
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
    await client.query('DELETE FROM public."User" WHERE "id" IN ($1, $2, $3, $4)', [
      seeded.teenId,
      seeded.guardianReadOnlyId,
      seeded.guardianFullAccessId,
      seeded.outsiderGuardianId,
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
    const targetTables = [...guardianSharedTables, ...selfOnlyTables, 'GuardianConsent']
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

      expect(policyMap.get('GuardianConsent')).toEqual(
        new Set(['authenticated_read_guardian_consent'])
      )
    } finally {
      client.release()
    }
  })

  it('allows teens to read and update their own wardrobe-scoped rows', async () => {
    scenario = await seedScenario()

    await withRole(
      'authenticated',
      buildClaims(scenario.teenEmail, 'teen'),
      async (client) => {
        const garmentRows = await client.query<{
          id: string
          category: string
        }>('SELECT "id", "category" FROM public."GarmentItem" WHERE "user_id" = $1', [
          scenario!.teenId,
        ])

        expect(garmentRows.rows).toEqual([
          {
            id: scenario!.garmentId,
            category: 'top',
          },
        ])

        await client.query(
          'UPDATE public."GarmentItem" SET "category" = $1, "updated_at" = NOW() WHERE "id" = $2',
          ['outerwear', scenario!.garmentId]
        )

        const updatedProfile = await client.query<{
          display_name: string
        }>('SELECT "display_name" FROM public."UserProfile" WHERE "user_id" = $1', [
          scenario!.teenId,
        ])

        expect(updatedProfile.rows[0]?.display_name).toBe('Teen Wardrobe Owner')
      }
    )
  })

  it('lets linked guardians read teen wardrobe data but blocks read-only mutations', async () => {
    scenario = await seedScenario()

    await withRole(
      'authenticated',
      buildClaims(scenario.guardianReadOnlyEmail, 'guardian'),
      async (client) => {
        const garmentRows = await client.query<{
          id: string
        }>('SELECT "id" FROM public."GarmentItem" WHERE "user_id" = $1', [
          scenario!.teenId,
        ])

        expect(garmentRows.rows).toHaveLength(1)

        const consentRows = await client.query<{
          teen_id: string
        }>('SELECT "teen_id" FROM public."GuardianConsent" WHERE "guardian_id" = $1', [
          scenario!.guardianReadOnlyId,
        ])

        expect(consentRows.rows).toEqual([{ teen_id: scenario!.teenId }])

        const updateResult = await client.query(
          `UPDATE public."GarmentItem"
           SET "category" = $1, "updated_at" = NOW()
           WHERE "id" = $2
           RETURNING "id"`,
          ['coat', scenario!.garmentId]
        )

        expect(updateResult.rowCount).toBe(0)
      }
    )
  })

  it('grants wardrobe access from a single active guardian consent row', async () => {
    scenario = await seedScenario()

    const client = await adminPool.connect()

    try {
      await client.query('DELETE FROM public."GuardianConsent" WHERE "id" = $1', [
        scenario.consentFullId,
      ])
    } finally {
      client.release()
    }

    await withRole(
      'authenticated',
      buildClaims(scenario.teenEmail, 'teen'),
      async (client) => {
        const teenGarments = await client.query(
          'SELECT "id" FROM public."GarmentItem" WHERE "user_id" = $1',
          [scenario!.teenId]
        )

        expect(teenGarments.rows).toEqual([{ id: scenario!.garmentId }])
      }
    )

    await withRole(
      'authenticated',
      buildClaims(scenario.guardianReadOnlyEmail, 'guardian'),
      async (client) => {
        const guardianGarments = await client.query(
          'SELECT "id" FROM public."GarmentItem" WHERE "user_id" = $1',
          [scenario!.teenId]
        )

        expect(guardianGarments.rows).toEqual([{ id: scenario!.garmentId }])
      }
    )
  })

  it('lets full-access guardians mutate linked teen wardrobe rows', async () => {
    scenario = await seedScenario()

    await withRole(
      'authenticated',
      buildClaims(scenario.guardianFullAccessEmail, 'guardian'),
      async (client) => {
        const updateResult = await client.query<{
          category: string
        }>(
          `UPDATE public."GarmentItem"
           SET "category" = $1, "updated_at" = NOW()
           WHERE "id" = $2
           RETURNING "category"`,
          ['jacket', scenario!.garmentId]
        )

        expect(updateResult.rows).toEqual([{ category: 'jacket' }])

        const insertResult = await client.query<{
          id: string
        }>(
          `INSERT INTO public."OutfitRecommendation"
            ("id", "user_id", "scenario", "updated_at")
           VALUES ($1, $2, $3, NOW())
           RETURNING "id"`,
          [`guardian-created-outfit-${randomUUID()}`, scenario!.teenId, 'school-run']
        )

        expect(insertResult.rows).toHaveLength(1)
      }
    )
  })

  it('keeps remaining guardian wardrobe access after one guardian revokes consent', async () => {
    scenario = await seedScenario()

    const adminClient = await adminPool.connect()

    try {
      await adminClient.query(
        `UPDATE public."GuardianConsent"
         SET "revoked_at" = NOW(), "status" = 'revoked'
         WHERE "id" = $1`,
        [scenario.consentReadOnlyId]
      )
    } finally {
      adminClient.release()
    }

    await withRole(
      'authenticated',
      buildClaims(scenario.guardianReadOnlyEmail, 'guardian'),
      async (client) => {
        const revokedGuardianRows = await client.query(
          'SELECT "id" FROM public."GarmentItem" WHERE "user_id" = $1',
          [scenario!.teenId]
        )

        expect(revokedGuardianRows.rows).toHaveLength(0)
      }
    )

    await withRole(
      'authenticated',
      buildClaims(scenario.guardianFullAccessEmail, 'guardian'),
      async (client) => {
        const remainingGuardianRows = await client.query(
          'SELECT "id" FROM public."GarmentItem" WHERE "user_id" = $1',
          [scenario!.teenId]
        )

        expect(remainingGuardianRows.rows).toEqual([{ id: scenario!.garmentId }])

        const updateResult = await client.query(
          `UPDATE public."GarmentItem"
           SET "category" = $1, "updated_at" = NOW()
           WHERE "id" = $2
           RETURNING "category"`,
          ['remaining-guardian-reviewed', scenario!.garmentId]
        )

        expect(updateResult.rows).toEqual([{ category: 'remaining-guardian-reviewed' }])
      }
    )
  })

  it('keeps social tables self-scoped until community sharing semantics exist', async () => {
    scenario = await seedScenario()

    await withRole(
      'authenticated',
      buildClaims(scenario.teenEmail, 'teen'),
      async (client) => {
        const ownPosts = await client.query(
          'SELECT "id" FROM public."LookbookPost" WHERE "user_id" = $1',
          [scenario!.teenId]
        )

        expect(ownPosts.rows).toHaveLength(1)
      }
    )

    await withRole(
      'authenticated',
      buildClaims(scenario.guardianFullAccessEmail, 'guardian'),
      async (client) => {
        const teenPosts = await client.query(
          'SELECT "id" FROM public."LookbookPost" WHERE "user_id" = $1',
          [scenario!.teenId]
        )

        expect(teenPosts.rows).toHaveLength(0)
      }
    )
  })

  it('denies teens from reading another teen wardrobe', async () => {
    scenario = await seedScenario()

    const otherTeenId = `other-teen-${randomUUID()}`
    const otherGarmentId = `other-garment-${randomUUID()}`
    const client = await adminPool.connect()

    try {
      await client.query('BEGIN')
      await insertUser(client, otherTeenId, `${otherTeenId}@example.com`)
      await client.query(
        `INSERT INTO public."GarmentItem"
          ("id", "user_id", "category", "updated_at")
         VALUES ($1, $2, $3, NOW())`,
        [otherGarmentId, otherTeenId, 'dress']
      )
      await client.query('COMMIT')

      await withRole(
        'authenticated',
        buildClaims(scenario.teenEmail, 'teen'),
        async (guardedClient) => {
          const otherTeenRows = await guardedClient.query(
            'SELECT "id" FROM public."GarmentItem" WHERE "user_id" = $1',
            [otherTeenId]
          )

          expect(otherTeenRows.rows).toHaveLength(0)
        }
      )
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      throw error
    } finally {
      await client.query('DELETE FROM public."GarmentItem" WHERE "id" = $1', [
        otherGarmentId,
      ])
      await client.query('DELETE FROM public."User" WHERE "id" = $1', [otherTeenId])
      client.release()
    }
  })

  it('does not trust unverified email claims for cross-account access', async () => {
    scenario = await seedScenario()

    await withRole(
      'authenticated',
      {
        sub: randomUUID(),
        email: scenario.teenEmail,
        email_verified: false,
        role: 'authenticated',
        app_metadata: {
          role: 'guardian',
        },
      },
      async (client) => {
        const garmentRows = await client.query(
          'SELECT "id" FROM public."GarmentItem" WHERE "user_id" = $1',
          [scenario!.teenId]
        )

        expect(garmentRows.rows).toHaveLength(0)
      }
    )
  })

  it('denies unrelated guardians and anonymous actors from teen wardrobe data', async () => {
    scenario = await seedScenario()

    await withRole(
      'authenticated',
      buildClaims(scenario.outsiderGuardianEmail, 'guardian'),
      async (client) => {
        const garmentRows = await client.query(
          'SELECT "id" FROM public."GarmentItem" WHERE "user_id" = $1',
          [scenario!.teenId]
        )

        expect(garmentRows.rows).toHaveLength(0)
      }
    )

    await withRole('anon', null, async (client) => {
      await expect(
        client.query('SELECT "id" FROM public."GarmentItem" WHERE "user_id" = $1', [
          scenario!.teenId,
        ])
      ).rejects.toMatchObject({
        code: '42501',
      })
    })
  })

  it('does not grant access from user_metadata identity or role claims', async () => {
    scenario = await seedScenario()

    await withRole(
      'authenticated',
      {
        sub: randomUUID(),
        email: scenario.outsiderGuardianEmail,
        email_verified: true,
        role: 'authenticated',
        app_metadata: {
          role: 'guardian',
        },
        user_metadata: {
          app_user_id: scenario.teenId,
          app_role: 'admin',
          role: 'admin',
        },
      },
      async (client) => {
        const garmentRows = await client.query(
          'SELECT "id" FROM public."GarmentItem" WHERE "user_id" = $1',
          [scenario!.teenId]
        )

        expect(garmentRows.rows).toHaveLength(0)
      }
    )
  })

  it('blocks teen self access after the last guardian consent is revoked', async () => {
    scenario = await seedScenario()

    const client = await adminPool.connect()

    try {
      await client.query('BEGIN')
      await client.query(
        `UPDATE public."GuardianConsent"
         SET "revoked_at" = NOW(), "status" = 'revoked'
         WHERE "teen_id" = $1`,
        [scenario.teenId]
      )
      await client.query(
        `UPDATE public."UserProfile"
         SET "preferences" = $2::jsonb, "updated_at" = NOW()
         WHERE "user_id" = $1`,
        [
          scenario.teenId,
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
      buildClaims(scenario.teenEmail, 'teen'),
      async (guardedClient) => {
        const garmentRows = await guardedClient.query(
          'SELECT "id" FROM public."GarmentItem" WHERE "user_id" = $1',
          [scenario!.teenId]
        )

        expect(garmentRows.rows).toHaveLength(0)

        const updateResult = await guardedClient.query(
          `UPDATE public."GarmentItem"
           SET "category" = $1, "updated_at" = NOW()
           WHERE "id" = $2
           RETURNING "id"`,
          ['restored-without-consent', scenario!.garmentId]
        )

        expect(updateResult.rowCount).toBe(0)
      }
    )
  })

  it('does not allow authenticated callers to execute the guardian-consent helper directly', async () => {
    scenario = await seedScenario()

    await withRole(
      'authenticated',
      buildClaims(scenario.teenEmail, 'teen'),
      async (client) => {
        await expect(
          client.query('SELECT private.user_requires_guardian_consent($1)', [
            scenario!.teenId,
          ])
        ).rejects.toMatchObject({
          code: '42501',
        })
      }
    )
  })

  it('allows admin claims to inspect and update teen wardrobe rows without service role bypass', async () => {
    scenario = await seedScenario()

    await withRole(
      'authenticated',
      buildClaims(`admin-${randomUUID()}@example.com`, 'admin'),
      async (client) => {
        const garmentRows = await client.query(
          'SELECT "id" FROM public."GarmentItem" WHERE "user_id" = $1',
          [scenario!.teenId]
        )

        expect(garmentRows.rows).toHaveLength(1)

        const updateResult = await client.query(
          `UPDATE public."GarmentItem"
           SET "category" = $1, "updated_at" = NOW()
           WHERE "id" = $2
           RETURNING "category"`,
          ['admin-reviewed', scenario!.garmentId]
        )

        expect(updateResult.rows).toEqual([{ category: 'admin-reviewed' }])
      }
    )
  })
})

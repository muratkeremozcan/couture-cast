// Alert rules, notification preferences, push tokens, and event envelopes. All of
// these are owner-only rather than guardian-shared, so the guardian actors appear
// here only to be denied.
import { randomUUID } from 'node:crypto'
import { describe, expect } from 'vitest'
import { buildClaims, scenarioTest, useRlsDatabase, withRole } from './harness.js'

describe.concurrent('guardian-aware RLS policies', () => {
  useRlsDatabase()

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
})

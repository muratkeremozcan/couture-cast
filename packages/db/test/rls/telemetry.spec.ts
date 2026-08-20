// Learning path Step 18: Telemetry and audit baseline.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-18-telemetry-and-audit-baseline
import { randomUUID } from 'node:crypto'
import { describe, expect } from 'vitest'
import { buildClaims, scenarioTest, useRlsDatabase, withRole } from './harness.js'

describe.concurrent('guardian-aware RLS policies', () => {
  useRlsDatabase()

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
})

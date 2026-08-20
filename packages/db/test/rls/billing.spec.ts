// Learning path Step 34: Premium subscription lifecycle.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-34-premium-subscription-lifecycle
import { randomUUID } from 'node:crypto'
import { describe, expect } from 'vitest'
import { buildClaims, scenarioTest, useRlsDatabase, withRole } from './harness.js'

describe.concurrent('guardian-aware RLS policies', () => {
  useRlsDatabase()

  scenarioTest(
    '5.2-DB-013 rejects authenticated reads and forgeries of billing state',
    async ({ scenario: seeded }) => {
      // Same falsifiability standard as 5.1-DB-007: the seeded rows BELONG to
      // this teen, and the owner is still rejected — the deny is worker-only
      // posture, not a missing row. A forged INSERT is the free-Premium attack
      // and must fail identically.
      const billingTables = ['PremiumEntitlement', 'BillingEvent', 'BillingCustomer']

      for (const table of billingTables) {
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

      await withRole(
        'authenticated',
        buildClaims(seeded.teenEmail, 'teen'),
        async (client) => {
          await expect(
            client.query(
              `INSERT INTO public."PremiumEntitlement"
                ("id", "user_id", "status", "store", "product_id", "will_renew",
                 "current_period_end", "synced_at", "last_event_occurred_at",
                 "last_event_id", "updated_at")
               VALUES ($1, $2, 'active', 'promotional', 'premium_annual', TRUE,
                       NOW() + INTERVAL '365 days', NOW(), NOW(), 'forged', NOW())`,
              [`forged-entitlement-${randomUUID()}`, seeded.teenId]
            )
          ).rejects.toMatchObject({ code: '42501' })
        }
      )
    }
  )
})

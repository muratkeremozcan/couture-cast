import { randomUUID } from 'node:crypto'
import { afterAll, describe, expect, it } from 'vitest'
import { Pool, type PoolClient } from 'pg'

/**
 * Story 5.2 Task 1: the premium billing schema, exercised against a real
 * PostgreSQL connection rather than by reading migration.sql as text.
 *
 * The properties pinned here are the ones a service bug would otherwise
 * silently erode: the (provider, external_event_id) idempotency barrier that
 * makes webhook replays inert, the append-only trigger that keeps financial
 * facts immutable while leaving the forward-outbox bookkeeping writable, and
 * the SetNull user link that lets a billing record survive account erasure as
 * an unattributed row.
 */

const databaseUrl =
  process.env.RLS_TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgresql://postgres:postgres@127.0.0.1:54322/postgres'

const adminPool = new Pool({ connectionString: databaseUrl, max: 4 })

/** Runs `body` inside a transaction that always rolls back, so tests stay isolated. */
const inRolledBackTransaction = async <T>(
  body: (client: PoolClient) => Promise<T>
): Promise<T> => {
  const client = await adminPool.connect()

  try {
    await client.query('BEGIN')
    return await body(client)
  } finally {
    try {
      await client.query('ROLLBACK')
    } catch {
      // Ignore rollback failures so the pooled client is still released.
    }
    client.release()
  }
}

type PremiumFixture = {
  userId: string
  entitlementId: string
  billingEventId: string
  billingCustomerId: string
}

const insertBillingEvent = async (
  client: PoolClient,
  id: string,
  userId: string | null,
  overrides: { provider?: string; externalEventId?: string } = {}
) => {
  await client.query(
    `INSERT INTO public."BillingEvent"
      ("id", "provider", "external_event_id", "event_type", "user_id",
       "store", "product_id", "payload", "occurred_at")
     VALUES ($1, $2, $3, 'INITIAL_PURCHASE', $4,
             'stripe', 'premium_monthly', $5::jsonb, NOW())`,
    [
      id,
      overrides.provider ?? 'revenuecat',
      overrides.externalEventId ?? `event-${id}`,
      userId,
      JSON.stringify({ eventType: 'INITIAL_PURCHASE', store: 'stripe' }),
    ]
  )
}

const seedPremiumGraph = async (client: PoolClient): Promise<PremiumFixture> => {
  const suffix = randomUUID()
  const fixture: PremiumFixture = {
    userId: `premium-owner-${suffix}`,
    entitlementId: `entitlement-${suffix}`,
    billingEventId: `billing-event-${suffix}`,
    billingCustomerId: `billing-customer-${suffix}`,
  }

  await client.query(
    'INSERT INTO public."User" ("id", "email", "updated_at") VALUES ($1, $2, NOW())',
    [fixture.userId, `premium-owner-${suffix}@example.com`]
  )

  await client.query(
    `INSERT INTO public."PremiumEntitlement"
      ("id", "user_id", "status", "store", "product_id", "will_renew",
       "current_period_end", "synced_at", "last_event_occurred_at",
       "last_event_id", "updated_at")
     VALUES ($1, $2, 'active', 'stripe', 'premium_monthly', TRUE,
             NOW() + INTERVAL '30 days', NOW(), NOW(), $3, NOW())`,
    [fixture.entitlementId, fixture.userId, `event-${suffix}`]
  )

  await insertBillingEvent(client, fixture.billingEventId, fixture.userId)

  await client.query(
    `INSERT INTO public."BillingCustomer"
      ("id", "user_id", "stripe_customer_id", "updated_at")
     VALUES ($1, $2, $3, NOW())`,
    [fixture.billingCustomerId, fixture.userId, `cus_test_${suffix}`]
  )

  return fixture
}

afterAll(async () => {
  await adminPool.end()
})

describe('premium billing schema', () => {
  describe('BillingEvent idempotency barrier', () => {
    it('5.2-DB-011 rejects a second event with the same provider and external id', async () => {
      await inRolledBackTransaction(async (client) => {
        const fixture = await seedPremiumGraph(client)

        await expect(
          insertBillingEvent(client, `replay-${randomUUID()}`, fixture.userId, {
            externalEventId: `event-${fixture.billingEventId}`,
          })
        ).rejects.toMatchObject({ code: '23505' })
      })
    })

    it('5.2-DB-011b allows the same external id from a different provider', async () => {
      // The barrier is per-provider on purpose: Stripe and RevenueCat ids live
      // in different namespaces and must never collide with each other.
      await inRolledBackTransaction(async (client) => {
        const fixture = await seedPremiumGraph(client)

        await insertBillingEvent(client, `stripe-${randomUUID()}`, fixture.userId, {
          provider: 'stripe',
          externalEventId: `event-${fixture.billingEventId}`,
        })
      })
    })

    it('5.2-DB-011c rejects an empty external event id outright', async () => {
      // An empty id would collapse distinct events onto one idempotency slot.
      await inRolledBackTransaction(async (client) => {
        const fixture = await seedPremiumGraph(client)

        await expect(
          insertBillingEvent(client, `empty-${randomUUID()}`, fixture.userId, {
            externalEventId: '',
          })
        ).rejects.toMatchObject({ code: '23514' })
      })
    })
  })

  describe('BillingEvent append-only trigger', () => {
    it('5.2-DB-010 rejects an UPDATE of a financial column with 42501', async () => {
      // Behavioural, not convention: the trigger actually fires, exactly as the
      // audit-log immutability suite proves for AuditLog. One transaction per
      // rejection — a rejected statement aborts its transaction.
      await inRolledBackTransaction(async (client) => {
        const fixture = await seedPremiumGraph(client)

        await expect(
          client.query(
            'UPDATE public."BillingEvent" SET "payload" = \'{}\'::jsonb WHERE "id" = $1',
            [fixture.billingEventId]
          )
        ).rejects.toMatchObject({ code: '42501' })
      })

      await inRolledBackTransaction(async (client) => {
        const fixture = await seedPremiumGraph(client)

        await expect(
          client.query(
            'UPDATE public."BillingEvent" SET "event_type" = \'RENEWAL\' WHERE "id" = $1',
            [fixture.billingEventId]
          )
        ).rejects.toMatchObject({ code: '42501' })
      })
    })

    it('5.2-DB-010b allows the forward-outbox bookkeeping columns to change', async () => {
      // The reconciliation sweep stamps forwards on this row. Blocking these
      // columns would force the outbox into a second table for no gain.
      await inRolledBackTransaction(async (client) => {
        const fixture = await seedPremiumGraph(client)

        const updated = await client.query(
          `UPDATE public."BillingEvent"
           SET "forwarded_at" = NOW(), "forward_attempts" = 1,
               "forward_last_error" = NULL
           WHERE "id" = $1`,
          [fixture.billingEventId]
        )
        expect(updated.rowCount).toBe(1)
      })
    })

    it('5.2-DB-010c leaves DELETE open for the retention pruner', async () => {
      await inRolledBackTransaction(async (client) => {
        const fixture = await seedPremiumGraph(client)

        const deleted = await client.query(
          'DELETE FROM public."BillingEvent" WHERE "id" = $1',
          [fixture.billingEventId]
        )
        expect(deleted.rowCount).toBe(1)
      })
    })
  })

  describe('user erasure', () => {
    it('5.2-DB-012 keeps the billing event as an unattributed row when the user is deleted', async () => {
      await inRolledBackTransaction(async (client) => {
        const fixture = await seedPremiumGraph(client)

        // The FK's SET NULL executes as an UPDATE of the referencing row, so
        // this also proves the append-only trigger does not block erasure.
        await client.query('DELETE FROM public."User" WHERE "id" = $1', [fixture.userId])

        const event = await client.query<{ user_id: string | null }>(
          'SELECT "user_id" FROM public."BillingEvent" WHERE "id" = $1',
          [fixture.billingEventId]
        )
        expect(event.rows).toHaveLength(1)
        expect(event.rows[0]?.user_id).toBeNull()

        // Entitlement and customer mapping cascade away with the account: they
        // are live privilege/identity state, not financial history.
        const entitlement = await client.query(
          'SELECT "id" FROM public."PremiumEntitlement" WHERE "id" = $1',
          [fixture.entitlementId]
        )
        expect(entitlement.rows).toHaveLength(0)

        const customer = await client.query(
          'SELECT "id" FROM public."BillingCustomer" WHERE "id" = $1',
          [fixture.billingCustomerId]
        )
        expect(customer.rows).toHaveLength(0)
      })
    })
  })

  describe('PremiumEntitlement constraints', () => {
    it('5.2-DB-014 enforces one entitlement row per user', async () => {
      await inRolledBackTransaction(async (client) => {
        const fixture = await seedPremiumGraph(client)

        await expect(
          client.query(
            `INSERT INTO public."PremiumEntitlement"
              ("id", "user_id", "status", "store", "product_id", "will_renew",
               "current_period_end", "synced_at", "last_event_occurred_at",
               "last_event_id", "updated_at")
             VALUES ($1, $2, 'expired', 'stripe', 'premium_monthly', FALSE,
                     NOW(), NOW(), NOW(), 'second-row', NOW())`,
            [`entitlement-dup-${randomUUID()}`, fixture.userId]
          )
        ).rejects.toMatchObject({ code: '23505' })
      })
    })

    it('5.2-DB-015 rejects an empty last event id', async () => {
      await inRolledBackTransaction(async (client) => {
        const suffix = randomUUID()
        await client.query(
          'INSERT INTO public."User" ("id", "email", "updated_at") VALUES ($1, $2, NOW())',
          [`premium-empty-${suffix}`, `premium-empty-${suffix}@example.com`]
        )

        await expect(
          client.query(
            `INSERT INTO public."PremiumEntitlement"
              ("id", "user_id", "status", "store", "product_id", "will_renew",
               "current_period_end", "synced_at", "last_event_occurred_at",
               "last_event_id", "updated_at")
             VALUES ($1, $2, 'active', 'stripe', 'premium_monthly', TRUE,
                     NOW(), NOW(), NOW(), '', NOW())`,
            [`entitlement-empty-${suffix}`, `premium-empty-${suffix}`]
          )
        ).rejects.toMatchObject({ code: '23514' })
      })
    })
  })

  describe('BillingCustomer constraints', () => {
    it('5.2-DB-016 rejects a second stripe mapping for the same user', async () => {
      await inRolledBackTransaction(async (client) => {
        const fixture = await seedPremiumGraph(client)
        const suffix = randomUUID()

        await expect(
          client.query(
            `INSERT INTO public."BillingCustomer"
              ("id", "user_id", "stripe_customer_id", "updated_at")
             VALUES ($1, $2, $3, NOW())`,
            [`customer-dup-user-${suffix}`, fixture.userId, `cus_test_dup_${suffix}`]
          )
        ).rejects.toMatchObject({ code: '23505' })
      })
    })

    it('5.2-DB-016b rejects a stripe customer already claimed by another user', async () => {
      await inRolledBackTransaction(async (client) => {
        const fixture = await seedPremiumGraph(client)
        const suffix = randomUUID()

        await client.query(
          'INSERT INTO public."User" ("id", "email", "updated_at") VALUES ($1, $2, NOW())',
          [`premium-second-${suffix}`, `premium-second-${suffix}@example.com`]
        )
        const existing = await client.query<{ stripe_customer_id: string }>(
          'SELECT "stripe_customer_id" FROM public."BillingCustomer" WHERE "id" = $1',
          [fixture.billingCustomerId]
        )
        await expect(
          client.query(
            `INSERT INTO public."BillingCustomer"
              ("id", "user_id", "stripe_customer_id", "updated_at")
             VALUES ($1, $2, $3, NOW())`,
            [
              `customer-dup-stripe-${suffix}`,
              `premium-second-${suffix}`,
              existing.rows[0]?.stripe_customer_id,
            ]
          )
        ).rejects.toMatchObject({ code: '23505' })
      })
    })
  })
})

import 'reflect-metadata'
import { noComplimentaryGrants } from './helpers/no-complimentary-grants.js'
import { randomUUID } from 'node:crypto'
import { PrismaClient } from '@prisma/client'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildBillingEventCreateInput,
  buildPremiumEntitlementCreateInput,
  createBillingEvent,
  createPremiumEntitlement,
} from '@couture/testing'
import {
  BillingReconciliationService,
  DRIFT_STALENESS_HOURS,
} from '../src/modules/commerce/billing-reconciliation.service.js'
import { PremiumEntitlementService } from '../src/modules/commerce/premium-entitlement.service.js'
import {
  FakeRevenueCatClient,
  RealRevenueCatClient,
  RevenueCatRequestError,
  RevenueCatUnrepresentableEntitlementError,
  RevenueCatUnsupportedStoreError,
} from '../src/modules/commerce/revenuecat-client.js'
import { FakeStripeBillingClient } from '../src/modules/commerce/stripe-client.js'
import type { TelemetryService } from '../src/modules/telemetry/telemetry.service.js'

/**
 * Story 5.2 Decision 4a: the reconciliation sweep against real PostgreSQL —
 * 5.2-INT-025 (a failed forward is re-driven by the sweep and the entitlement
 * activates through the same read path the product uses) and 5.2-INT-042
 * (drift correction downgrades a stale local `active` the ledger says is
 * gone, with the audit row). The sweep is invoked directly, which is exactly
 * how the worker's job processor calls it — deterministic, no queue, no
 * wall-clock sleeps.
 *
 * NOTE: no workflow runs `test:integration` in CI (deferred-work #10); this
 * evidence exists where `npm run test --workspace api` runs against a live
 * database.
 */

const databaseUrl =
  process.env.INTEGRATION_TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgresql://postgres:postgres@127.0.0.1:54322/postgres'

const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } })

let schemaReady = false

async function probeSchema(): Promise<void> {
  try {
    await prisma.$queryRaw`SELECT 1 FROM "PremiumEntitlement" LIMIT 1`
    await prisma.$queryRaw`SELECT 1 FROM "BillingEvent" LIMIT 1`
    schemaReady = true
  } catch {
    schemaReady = false
    // eslint-disable-next-line no-console
    console.warn(
      '[premium-reconciliation.integration] Skipped: PostgreSQL is missing the Story 5.2 billing schema. ' +
        'Run `npm run db:migrate` to execute this suite.'
    )
  }
}

function requireSchema(context: { skip: () => void }): boolean {
  if (!schemaReady) {
    context.skip()
    return false
  }
  return true
}

/**
 * The sweep's table scans are global by design (that IS the production job),
 * but this database is shared: seed fixtures and parallel suite files own
 * stale entitlement rows of their own. Pulls for any user this file does not
 * own THROW, and the sweep's per-row crash isolation leaves those rows
 * untouched — proving the isolation property while keeping the shared
 * database's state out of this file's blast radius.
 */
class ScopedLedger extends FakeRevenueCatClient {
  constructor(private readonly ownedUserId: () => string) {
    super()
  }

  override getSubscriberEntitlement(appUserId: string) {
    if (appUserId !== this.ownedUserId()) {
      return Promise.reject(
        new Error('out-of-scope subscriber pull; row belongs to another suite')
      )
    }
    return super.getSubscriberEntitlement(appUserId)
  }
}

describe('5.2 billing reconciliation sweep against real PostgreSQL', () => {
  const namespace = `recon52-${randomUUID().slice(0, 8)}`
  let userId: string
  let ledger: ScopedLedger
  let service: BillingReconciliationService
  const telemetry = { captureEvent: vi.fn() }

  function buildService(): BillingReconciliationService {
    ledger = new ScopedLedger(() => userId)
    const entitlements = new PremiumEntitlementService(
      prisma,
      ledger,
      new FakeStripeBillingClient(),
      noComplimentaryGrants
    )
    return new BillingReconciliationService(
      prisma,
      ledger,
      entitlements,
      telemetry as unknown as TelemetryService
    )
  }

  async function seedDueForwardRow(fetchToken: string | null): Promise<string> {
    const fixture = createBillingEvent({
      provider: 'stripe',
      externalEventId: `${namespace}-evt-${randomUUID().slice(0, 8)}`,
      eventType: 'checkout.session.completed',
      userId,
      // The factory pins the Decision 6 allowlist; spreading it keeps this
      // suite from re-stating the projection keys, which is what made a
      // projection change a multi-file edit. `fetchToken` is the forward
      // trigger's one addition and is the only key set by hand.
      payload: {
        ...createBillingEvent().payload,
        eventType: 'checkout.session.completed',
        periodType: null,
        purchasedAtMs: null,
        expirationAtMs: null,
        environment: 'false',
        fetchToken,
      },
      forwardDue: true,
      forwardAttempts: 1,
      forwardLastError: 'inline attempt failed: simulated outage',
    })

    const row = await prisma.billingEvent.create({
      data: {
        ...buildBillingEventCreateInput(fixture),
        // Backdated past the settling window so the sweep owns it; freshly
        // received rows belong to their inline attempt (and to whichever
        // parallel suite just created them). `received_at` is defaulted by the
        // column, so it is set here rather than on the fixture.
        received_at: new Date(Date.now() - 60 * 60 * 1000),
      },
      select: { id: true },
    })
    return row.id
  }

  beforeAll(async () => {
    await probeSchema()
    if (!schemaReady) return
    const user = await prisma.user.create({
      data: { email: `${namespace}-user@synthetic.test` },
    })
    userId = user.id
  })

  beforeEach(async () => {
    telemetry.captureEvent.mockReset().mockResolvedValue(undefined)
    service = buildService()
    if (schemaReady) {
      await prisma.billingEvent.deleteMany({
        where: { external_event_id: { startsWith: namespace } },
      })
      await prisma.premiumEntitlement.deleteMany({ where: { user_id: userId } })
    }
  })

  afterAll(async () => {
    if (schemaReady) {
      await prisma.billingEvent.deleteMany({
        where: { external_event_id: { startsWith: namespace } },
      })
      await prisma.premiumEntitlement.deleteMany({ where: { user_id: userId } })
      // The user is NOT deleted: drift corrections wrote immutable AuditLog
      // rows and AuditLog->User is RESTRICT (namespaced synthetic on a
      // disposable database).
    }
    await prisma.$disconnect()
  })

  it('5.2-INT-025: re-drives a due forward and the entitlement activates', async (context) => {
    if (!requireSchema(context)) return

    const rowId = await seedDueForwardRow(`sub_${namespace}`)

    const result = await service.sweep()

    expect(result.forwardsRedriven).toBe(1)
    const row = await prisma.billingEvent.findUnique({ where: { id: rowId } })
    expect(row?.forwarded_at).not.toBeNull()
    expect(row?.forward_last_error).toBeNull()
    expect(row?.forward_attempts).toBe(2)

    // The fake ledger materialized the forwarded subscription (mirroring RC's
    // real Stripe integration), the sweep pulled it, and the mirror now shows
    // the paid-but-locked window closed.
    const entitlement = await prisma.premiumEntitlement.findUnique({
      where: { user_id: userId },
    })
    expect(entitlement).toMatchObject({ status: 'active', store: 'stripe' })
    expect(telemetry.captureEvent).toHaveBeenCalledWith(
      userId,
      'premium_entitlement_activated',
      expect.objectContaining({ store: 'stripe' })
    )
  })

  it('a still-failing forward stays due for the next sweep, attempts counted', async (context) => {
    if (!requireSchema(context)) return

    const rowId = await seedDueForwardRow(`sub_${namespace}`)
    ledger.failNextCall()

    const result = await service.sweep()

    expect(result.forwardsFailed).toBe(1)
    const row = await prisma.billingEvent.findUnique({ where: { id: rowId } })
    expect(row?.forward_due).toBe(true)
    expect(row?.forwarded_at).toBeNull()
    expect(row?.forward_attempts).toBe(2)
  })

  it('5.2-INT-042: drift correction downgrades a stale active the ledger disowns, with the audit row', async (context) => {
    if (!requireSchema(context)) return

    // 48 hours against the sweep's 24-hour staleness bound: an order of
    // magnitude of margin, so JS-vs-database clock skew cannot flip this.
    const staleSyncedAt = new Date(Date.now() - 48 * 60 * 60 * 1000)
    await prisma.premiumEntitlement.create({
      data: buildPremiumEntitlementCreateInput(
        createPremiumEntitlement({
          userId,
          status: 'active',
          syncedAt: staleSyncedAt,
          lastEventOccurredAt: staleSyncedAt,
          lastEventId: `${namespace}-stale-seed`,
        })
      ),
    })
    // The fake ledger reports no entitlement: the mirror must follow.
    const auditsBefore = await prisma.auditLog.count({
      where: { user_id: userId, event_type: 'premium_entitlement_changed' },
    })

    const result = await service.sweep()

    // >= because the shared database's seed fixtures are also stale; their
    // out-of-scope pulls throw and leave them untouched (crash isolation).
    expect(result.entitlementsChecked).toBeGreaterThanOrEqual(1)
    expect(result.entitlementsCorrected).toBe(1)
    const row = await prisma.premiumEntitlement.findUnique({
      where: { user_id: userId },
    })
    expect(row).toMatchObject({ status: 'expired', will_renew: false })
    const auditsAfter = await prisma.auditLog.count({
      where: { user_id: userId, event_type: 'premium_entitlement_changed' },
    })
    expect(auditsAfter - auditsBefore).toBe(1)
    expect(telemetry.captureEvent).toHaveBeenCalledWith(
      userId,
      'premium_entitlement_deactivated',
      expect.objectContaining({ reason: 'expired' })
    )
  })

  // Learning path Step 55: Expo SDK 58 upgrade for live font-scale layout.
  // See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-55-expo-sdk-58-upgrade-for-live-font-scale-layout
  // Story 6.15 R3-01: the REST projection of a RevenueCat Test Store entitlement used to become an
  // active Stripe snapshot. Through the real client, the paid row now stays exactly as it was.
  // R4-01 adds the shapes that used to read as "no entitlement": a lifetime or malformed
  // entitlement, from a store we do not sell or one we do, and a missing product.
  const ledgerShapes = [
    [
      'Test Store monthly',
      { expires_date: 'FUTURE', product_identifier: 'premium_monthly' },
      { premium_monthly: { store: 'test_store' } },
    ],
    [
      'Test Store lifetime',
      { expires_date: null, product_identifier: 'premium_life' },
      { premium_life: { store: 'test_store' } },
    ],
    [
      'Amazon lifetime',
      { expires_date: null, product_identifier: 'premium_life' },
      { premium_life: { store: 'amazon' } },
    ],
    [
      'supported lifetime',
      { expires_date: null, product_identifier: 'premium_life' },
      { premium_life: { store: 'play_store' } },
    ],
    [
      'malformed expiry',
      { expires_date: 'soon', product_identifier: 'premium_monthly' },
      { premium_monthly: { store: 'stripe' } },
    ],
    ['missing product', { expires_date: 'FUTURE', product_identifier: null }, {}],
  ] as const
  // `qa` stands for any TEST_ENV other than local and preview. Under the D15 local and preview
  // values every shape but the Test Store monthly one must still leave the paid row as it was.
  for (const testEnv of [
    undefined,
    'staging',
    'production',
    'qa',
    'local',
    'preview',
  ] as const)
    for (const [shape, premium, subscriptions] of ledgerShapes) {
      if (
        (testEnv === 'local' || testEnv === 'preview') &&
        shape === 'Test Store monthly'
      ) {
        continue
      }
      it(`a ${shape} ledger entitlement leaves a paid row unchanged (TEST_ENV ${testEnv ?? 'unset'})`, async (context) => {
        if (!requireSchema(context)) return
        const savedEnv = process.env.TEST_ENV
        if (testEnv === undefined) delete process.env.TEST_ENV
        else process.env.TEST_ENV = testEnv
        const fetchMock = vi.fn((url: string) =>
          Promise.resolve(
            url.endsWith(`/subscribers/${encodeURIComponent(userId)}`)
              ? new Response(
                  JSON.stringify({
                    subscriber: {
                      entitlements: {
                        premium: {
                          ...premium,
                          expires_date:
                            premium.expires_date === 'FUTURE'
                              ? new Date(Date.now() + 30 * 86_400_000).toISOString()
                              : premium.expires_date,
                        },
                      },
                      subscriptions,
                    },
                  }),
                  { status: 200 }
                )
              : new Response('out of scope', { status: 503 })
          )
        )
        vi.stubGlobal('fetch', fetchMock)
        try {
          const realLedger = new RealRevenueCatClient('sk_test_rc_key')
          const sweeper = new BillingReconciliationService(
            prisma,
            realLedger,
            new PremiumEntitlementService(
              prisma,
              realLedger,
              new FakeStripeBillingClient(),
              noComplimentaryGrants
            ),
            telemetry as unknown as TelemetryService
          )
          const staleSyncedAt = new Date(Date.now() - 48 * 60 * 60 * 1000)
          await prisma.premiumEntitlement.create({
            data: buildPremiumEntitlementCreateInput(
              createPremiumEntitlement({
                userId,
                status: 'active',
                store: 'play_store',
                syncedAt: staleSyncedAt,
                lastEventOccurredAt: staleSyncedAt,
                lastEventId: `${namespace}-paid-seed`,
              })
            ),
          })
          const before = await prisma.premiumEntitlement.findUnique({
            where: { user_id: userId },
          })

          await sweeper.sweep()

          expect(fetchMock).toHaveBeenCalledWith(
            expect.stringContaining(encodeURIComponent(userId)),
            expect.anything()
          )
          // The ledger answer is permanent, so only synced_at moves (story 6.15): the row leaves
          // the head of the drift batch and its state stays exactly as it was.
          const after = await prisma.premiumEntitlement.findUnique({
            where: { user_id: userId },
          })
          expect(after).toEqual({
            ...before,
            synced_at: expect.any(Date) as Date,
            updated_at: expect.any(Date) as Date,
          })
          expect(after!.synced_at.getTime()).toBeGreaterThan(
            Date.now() - DRIFT_STALENESS_HOURS * 60 * 60 * 1000
          )
        } finally {
          vi.unstubAllGlobals()
          if (savedEnv === undefined) delete process.env.TEST_ENV
          else process.env.TEST_ENV = savedEnv
        }
      })
    }

  // Learning path Step 55: story 6.15 D15. Under an explicit local or preview TEST_ENV the sweep
  // converges a stale Test Store row to the ledger through the real REST projection.
  for (const testEnv of ['local', 'preview'] as const) {
    it(`converges a stale test_store row to the Test Store ledger (TEST_ENV ${testEnv})`, async (context) => {
      if (!requireSchema(context)) return
      const savedEnv = process.env.TEST_ENV
      process.env.TEST_ENV = testEnv
      const renewedEnd = new Date(Date.now() + 30 * 86_400_000)
      renewedEnd.setUTCMilliseconds(0)
      const fetchMock = vi.fn((url: string) =>
        Promise.resolve(
          url.endsWith(`/subscribers/${encodeURIComponent(userId)}`)
            ? new Response(
                JSON.stringify({
                  subscriber: {
                    entitlements: {
                      premium: {
                        expires_date: renewedEnd.toISOString(),
                        product_identifier: 'premium_monthly',
                      },
                    },
                    subscriptions: {
                      premium_monthly: {
                        store: 'test_store',
                        unsubscribe_detected_at: null,
                      },
                    },
                  },
                }),
                { status: 200 }
              )
            : new Response('out of scope', { status: 503 })
        )
      )
      vi.stubGlobal('fetch', fetchMock)
      try {
        const realLedger = new RealRevenueCatClient('sk_test_rc_key')
        const sweeper = new BillingReconciliationService(
          prisma,
          realLedger,
          new PremiumEntitlementService(
            prisma,
            realLedger,
            new FakeStripeBillingClient(),
            noComplimentaryGrants
          ),
          telemetry as unknown as TelemetryService
        )
        const staleSyncedAt = new Date(Date.now() - 48 * 60 * 60 * 1000)
        await prisma.premiumEntitlement.create({
          data: buildPremiumEntitlementCreateInput(
            createPremiumEntitlement({
              userId,
              status: 'active',
              store: 'test_store',
              productId: 'premium_monthly',
              willRenew: false,
              currentPeriodEnd: new Date(Date.now() + 86_400_000),
              syncedAt: staleSyncedAt,
              lastEventOccurredAt: staleSyncedAt,
              lastEventId: `${namespace}-test-store-seed`,
            })
          ),
        })

        await sweeper.sweep()

        const after = await prisma.premiumEntitlement.findUnique({
          where: { user_id: userId },
        })
        expect(after).toMatchObject({
          status: 'active',
          store: 'test_store',
          product_id: 'premium_monthly',
          will_renew: true,
          current_period_end: renewedEnd,
        })
        expect(after?.synced_at.getTime()).toBeGreaterThan(staleSyncedAt.getTime())
      } finally {
        vi.unstubAllGlobals()
        if (savedEnv === undefined) delete process.env.TEST_ENV
        else process.env.TEST_ENV = savedEnv
      }
    })
  }

  // Learning path Step 55: story 6.15 D15 r6. Against real Postgres, the drift query skips a stale
  // test_store row outside local and preview, so it is never pulled; under local and preview it is.
  for (const testEnv of [
    undefined,
    'staging',
    'production',
    'local',
    'preview',
  ] as const) {
    const open = testEnv === 'local' || testEnv === 'preview'
    it(`${open ? 'pulls' : 'never pulls'} a stale test_store row (TEST_ENV ${testEnv ?? 'unset'})`, async (context) => {
      if (!requireSchema(context)) return
      const savedEnv = process.env.TEST_ENV
      if (testEnv === undefined) delete process.env.TEST_ENV
      else process.env.TEST_ENV = testEnv
      const subscriberUrl = `/subscribers/${encodeURIComponent(userId)}`
      const fetchMock = vi.fn((url: string) =>
        Promise.resolve(
          url.endsWith(subscriberUrl)
            ? new Response(JSON.stringify({ subscriber: {} }), { status: 200 })
            : new Response('out of scope', { status: 503 })
        )
      )
      vi.stubGlobal('fetch', fetchMock)
      try {
        const realLedger = new RealRevenueCatClient('sk_test_rc_key')
        const sweeper = new BillingReconciliationService(
          prisma,
          realLedger,
          new PremiumEntitlementService(
            prisma,
            realLedger,
            new FakeStripeBillingClient(),
            noComplimentaryGrants
          ),
          telemetry as unknown as TelemetryService
        )
        const staleSyncedAt = new Date(Date.now() - 48 * 60 * 60 * 1000)
        await prisma.premiumEntitlement.create({
          data: buildPremiumEntitlementCreateInput(
            createPremiumEntitlement({
              userId,
              status: 'active',
              store: 'test_store',
              syncedAt: staleSyncedAt,
              lastEventOccurredAt: staleSyncedAt,
              lastEventId: `${namespace}-test-store-drift-seed`,
            })
          ),
        })

        await sweeper.sweep()

        const pulled = fetchMock.mock.calls.some(([url]) => url.endsWith(subscriberUrl))
        expect(pulled).toBe(open)
      } finally {
        vi.unstubAllGlobals()
        if (savedEnv === undefined) delete process.env.TEST_ENV
        else process.env.TEST_ENV = savedEnv
      }
    })
  }

  // Story 6.15: the drift batch takes the oldest synced_at first. A row whose ledger entitlement
  // our model cannot represent fails its pull the same way on every retry, so left stale it would
  // lead every batch and starve drift correction. A transient failure must still be retried.
  for (const [label, failure, pullsAcrossTwoSweeps] of [
    [
      'a permanently unrepresentable member does not lead the next sweep',
      () => new RevenueCatUnrepresentableEntitlementError('no_expiry'),
      1,
    ],
    [
      'an unsupported-store member does not lead the next sweep',
      () => new RevenueCatUnsupportedStoreError('amazon'),
      1,
    ],
    [
      'a transiently failing member still leads the next sweep',
      () => new RevenueCatRequestError(503, 'subscriber GET'),
      2,
    ],
  ] as const) {
    it(label, async (context) => {
      if (!requireSchema(context)) return

      const staleSyncedAt = new Date(Date.now() - 48 * 60 * 60 * 1000)
      await prisma.premiumEntitlement.create({
        data: buildPremiumEntitlementCreateInput(
          createPremiumEntitlement({
            userId,
            status: 'active',
            store: 'play_store',
            syncedAt: staleSyncedAt,
            lastEventOccurredAt: staleSyncedAt,
            lastEventId: `${namespace}-unrepresentable-seed`,
          })
        ),
      })
      const before = await prisma.premiumEntitlement.findUnique({
        where: { user_id: userId },
      })
      const pull = vi
        .spyOn(ledger, 'getSubscriberEntitlement')
        .mockImplementation((appUserId) =>
          Promise.reject(
            appUserId === userId
              ? failure()
              : new Error('out-of-scope subscriber pull; row belongs to another suite')
          )
        )
      const ownPulls = () =>
        pull.mock.calls.filter(([appUserId]) => appUserId === userId).length

      try {
        await service.sweep()
        expect(ownPulls()).toBe(1)
        await service.sweep()
        expect(ownPulls()).toBe(pullsAcrossTwoSweeps)
      } finally {
        pull.mockRestore()
      }

      const after = await prisma.premiumEntitlement.findUnique({
        where: { user_id: userId },
      })
      // Either way the ledger state is untouched; only a permanent answer moves synced_at.
      expect({ ...after, synced_at: null, updated_at: null }).toEqual({
        ...before,
        synced_at: null,
        updated_at: null,
      })
      if (pullsAcrossTwoSweeps === 1) {
        expect(after!.synced_at.getTime()).toBeGreaterThan(staleSyncedAt.getTime())
      } else {
        expect(after!.synced_at).toEqual(staleSyncedAt)
      }
    })
  }

  it('leaves a freshly-synced entitlement alone (staleness bound respected)', async (context) => {
    if (!requireSchema(context)) return

    const freshSyncedAt = new Date()
    await prisma.premiumEntitlement.create({
      data: buildPremiumEntitlementCreateInput(
        createPremiumEntitlement({
          userId,
          status: 'active',
          syncedAt: freshSyncedAt,
          lastEventOccurredAt: freshSyncedAt,
          lastEventId: `${namespace}-fresh-seed`,
        })
      ),
    })

    const before = await prisma.premiumEntitlement.findUnique({
      where: { user_id: userId },
    })

    await service.sweep()

    // A fresh row is outside the staleness bound: no pull, no change. The
    // untouched synced_at is the proof (a pull would have restamped it).
    const after = await prisma.premiumEntitlement.findUnique({
      where: { user_id: userId },
    })
    expect(after?.status).toBe('active')
    expect(after?.synced_at.toISOString()).toBe(before?.synced_at.toISOString())
  })
})

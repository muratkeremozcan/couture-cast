import 'reflect-metadata'
import { randomUUID } from 'node:crypto'
import { PrismaClient } from '@prisma/client'
import { UnauthorizedException, type INestApplication } from '@nestjs/common'
import { HttpAdapterHost } from '@nestjs/core'
import { Test, type TestingModule } from '@nestjs/testing'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildPremiumEntitlementCreateInput,
  createPremiumEntitlement,
} from '@couture/testing'
import { BILLING_WEBHOOK_UNAUTHORIZED_MESSAGE } from '../src/contracts/http.js'
import { ApiExceptionFilter } from '../src/filters/api-exception.filter.js'
import { RequestAuthGuard } from '../src/modules/auth/security.guards.js'
import type { AuthenticatedRequest } from '../src/modules/auth/security.types.js'
import { REVENUECAT_WEBHOOK_ROUTE } from '../src/modules/commerce/billing-webhook.controller.js'
import { buildTestOnlyRevenueCatWebhookAuth } from '../src/modules/commerce/billing-webhook.service.js'
import { CommerceModule } from '../src/modules/commerce/commerce.module.js'
import { FeatureFlagsWarmup } from '../src/modules/feature-flags/feature-flags.warmup.js'
import { FeatureFlagsService } from '../src/modules/feature-flags/feature-flags.service.js'
import { TelemetryService } from '../src/modules/telemetry/telemetry.service.js'

/**
 * Story 5.2 Task 5: the RevenueCat rail over real PostgreSQL and real HTTP.
 *
 * Covers: 5.2-INT-001 (webhook receipt → GET visibility in the same request
 * cycle), the ordering quartet 5.2-INT-010..013, the full Decision 4
 * transition table (5.2-API-010 — every cell, none invented here),
 * TRANSFER two-user semantics, 5.2-INT-040 (unknown app_user_id), and
 * 5.2-INT-043 (telemetry sink down → webhook still transitions and 200s).
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
      '[premium-revenuecat-webhook.integration] Skipped: PostgreSQL is missing the Story 5.2 billing schema. ' +
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

type RcEventInput = {
  id: string
  type: string
  app_user_id?: string | null
  product_id?: string | null
  expiration_at_ms?: number | null
  event_timestamp_ms: number
  store?: string | null
  period_type?: string | null
  purchased_at_ms?: number | null
  cancel_reason?: string | null
  environment?: string | null
  transferred_from?: string[]
  transferred_to?: string[]
}

describe('5.2 RevenueCat webhook rail against real PostgreSQL and real HTTP', () => {
  // File-private namespaces: user rows are per-file synthetics; event ids are
  // namespaced so parallel Vitest files can never collide on the
  // (provider, external_event_id) unique index.
  const namespace = `rc52-${randomUUID().slice(0, 8)}`
  let eventSequence = 0
  const nextEventId = () => `${namespace}-evt-${(eventSequence += 1)}`

  /** Seed baseline is far in the past so test events are always "newer". */
  const SEED_OCCURRED_AT = new Date('2026-01-01T00:00:00.000Z')
  const T0 = new Date('2026-08-10T10:00:00.000Z').getTime()
  const PERIOD_END = new Date('2030-01-01T00:00:00.000Z')

  let app: INestApplication | undefined
  let subscriberId: string
  let gainerId: string

  const featureFlags = { getFeatureFlag: vi.fn() }
  const telemetry = { captureEvent: vi.fn() }

  function httpServer() {
    if (!app) {
      throw new Error('App is not initialized')
    }
    return app.getHttpServer() as Parameters<typeof request>[0]
  }

  function postEvent(
    event: RcEventInput,
    options: { authorization?: string | null } = {}
  ) {
    const req = request(httpServer())
      .post(REVENUECAT_WEBHOOK_ROUTE)
      .set('content-type', 'application/json')
    const auth =
      options.authorization === undefined
        ? buildTestOnlyRevenueCatWebhookAuth()
        : options.authorization
    if (auth !== null) {
      req.set('authorization', auth)
    }
    return req.send(JSON.stringify({ api_version: '1.0', event }))
  }

  function purchaseEvent(overrides: Partial<RcEventInput> = {}): RcEventInput {
    return {
      id: nextEventId(),
      type: 'INITIAL_PURCHASE',
      app_user_id: subscriberId,
      product_id: 'premium_monthly',
      expiration_at_ms: PERIOD_END.getTime(),
      event_timestamp_ms: T0 + eventSequence * 1000,
      store: 'APP_STORE',
      period_type: 'NORMAL',
      environment: 'PRODUCTION',
      ...overrides,
    }
  }

  /**
   * Upsert rather than create: the 5.2-API-010 table walks every prior status
   * against the same user. Both branches derive from one factory-built row, so
   * the pinned defaults live in the factory and cannot drift between them.
   *
   * The store and product deliberately override the factory defaults: an
   * app_store/premium_seeded prior state makes it visible when an applied event
   * overwrites those fields from the event payload, which a stripe/monthly
   * default would hide.
   */
  async function seedEntitlement(
    userId: string,
    status: 'active' | 'grace_period' | 'expired' | 'revoked'
  ): Promise<void> {
    const data = buildPremiumEntitlementCreateInput(
      createPremiumEntitlement({
        userId,
        status,
        store: 'app_store',
        productId: 'premium_seeded',
        willRenew: status === 'active' || status === 'grace_period',
        currentPeriodEnd: PERIOD_END,
        syncedAt: SEED_OCCURRED_AT,
        lastEventOccurredAt: SEED_OCCURRED_AT,
        lastEventId: `${namespace}-seed`,
      })
    )
    // The generated id belongs to the create branch only: carrying it into
    // `update` would rewrite an existing row's primary key.
    delete (data as { id?: string }).id

    await prisma.premiumEntitlement.upsert({
      where: { user_id: userId },
      create: data,
      update: data,
    })
  }

  async function entitlementOf(userId: string) {
    return prisma.premiumEntitlement.findUnique({ where: { user_id: userId } })
  }

  async function auditCount(userId: string): Promise<number> {
    return prisma.auditLog.count({
      where: { user_id: userId, event_type: 'premium_entitlement_changed' },
    })
  }

  beforeAll(async () => {
    await probeSchema()
    if (!schemaReady) return

    const subscriber = await prisma.user.create({
      data: { email: `${namespace}-subscriber@synthetic.test` },
    })
    subscriberId = subscriber.id
    const gainer = await prisma.user.create({
      data: { email: `${namespace}-gainer@synthetic.test` },
    })
    gainerId = gainer.id

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [CommerceModule],
    })
      .overrideProvider(PrismaClient)
      .useValue(prisma)
      .overrideProvider(FeatureFlagsService)
      .useValue(featureFlags)
      .overrideProvider(FeatureFlagsWarmup)
      .useValue({ onModuleInit: () => Promise.resolve() })
      .overrideProvider(TelemetryService)
      .useValue(telemetry)
      .overrideGuard(RequestAuthGuard)
      .useValue({
        canActivate: (context: {
          switchToHttp: () => { getRequest: () => AuthenticatedRequest }
        }) => {
          const req = context.switchToHttp().getRequest()
          const header = req.headers.authorization ?? ''
          const match = /^Bearer premium-test:(.+)$/.exec(header)
          if (!match || !match[1]) {
            throw new UnauthorizedException('Missing or invalid bearer token')
          }
          req.auth = { token: header, userId: match[1], role: 'guardian' }
          return true
        },
      })
      .compile()

    // rawBody on app creation, not the module (5.1 B1 lesson): the webhook's
    // whole auth story reads request.rawBody.
    app = moduleFixture.createNestApplication({ rawBody: true })
    // The deployed app installs this filter globally; the no-api_error_occurred
    // assertion must run through the same wiring.
    app.useGlobalFilters(
      new ApiExceptionFilter(
        app.get(HttpAdapterHost),
        telemetry as unknown as TelemetryService
      )
    )
    await app.init()
  })

  beforeEach(async () => {
    featureFlags.getFeatureFlag.mockReset().mockResolvedValue(false)
    telemetry.captureEvent.mockReset().mockResolvedValue(undefined)
    if (schemaReady) {
      await prisma.premiumEntitlement.deleteMany({
        where: { user_id: { in: [subscriberId, gainerId] } },
      })
    }
  })

  afterAll(async () => {
    if (app) {
      await app.close()
    }
    if (schemaReady) {
      await prisma.billingEvent.deleteMany({
        where: { external_event_id: { startsWith: namespace } },
      })
      await prisma.premiumEntitlement.deleteMany({
        where: { user_id: { in: [subscriberId, gainerId] } },
      })
      // The users are NOT deleted: entitlement transitions wrote immutable
      // AuditLog rows and AuditLog->User is RESTRICT, so users that earned
      // audit rows are undeletable by design (namespaced synthetics).
    }
    await prisma.$disconnect()
  })

  describe('authentication (uniform rejection)', () => {
    it('rejects a missing Authorization header with the one shared message', async (context) => {
      if (!requireSchema(context)) return

      const response = await postEvent(purchaseEvent(), { authorization: null })

      expect(response.status).toBe(401)
      expect((response.body as { message?: string }).message).toBe(
        BILLING_WEBHOOK_UNAUTHORIZED_MESSAGE
      )
    })

    it('rejects a wrong credential identically, and parses nothing before auth', async (context) => {
      if (!requireSchema(context)) return

      // A schema-invalid body (missing event id/type) + a bad credential: the
      // 401 — not the 400 the same body earns once authenticated — proves the
      // payload schema never ran before authentication.
      const response = await request(httpServer())
        .post(REVENUECAT_WEBHOOK_ROUTE)
        .set('content-type', 'application/json')
        .set('authorization', 'not-the-configured-value-padded-to-length')
        .send(JSON.stringify({ event: {} }))

      expect(response.status).toBe(401)
      expect((response.body as { message?: string }).message).toBe(
        BILLING_WEBHOOK_UNAUTHORIZED_MESSAGE
      )
    })

    it('does not emit api_error_occurred for webhook rejections (excluded route)', async (context) => {
      if (!requireSchema(context)) return

      await postEvent(purchaseEvent(), { authorization: null })

      const apiErrorCalls = telemetry.captureEvent.mock.calls.filter(
        ([, eventType]) => eventType === 'api_error_occurred'
      )
      expect(apiErrorCalls).toHaveLength(0)
    })
  })

  describe('5.2-INT-001: entitlement visibility in the same request cycle', () => {
    it('a purchase webhook is visible to GET /subscription with no queue between', async (context) => {
      if (!requireSchema(context)) return

      const event = purchaseEvent()
      const webhook = await postEvent(event)
      expect(webhook.status).toBe(200)
      expect(webhook.body).toEqual({ data: { received: true } })

      const status = await request(httpServer())
        .get('/api/v1/commerce/subscription')
        .set('authorization', `Bearer premium-test:${subscriberId}`)

      expect(status.status).toBe(200)
      expect((status.body as { data: Record<string, unknown> }).data).toMatchObject({
        status: 'active',
        store: 'app_store',
        productId: 'premium_monthly',
        willRenew: true,
      })
    })
  })

  describe('ordering (5.2-INT-010..013, DB clock)', () => {
    it('5.2-INT-010: an exact replay is dropped at the unique index and answers 200', async (context) => {
      if (!requireSchema(context)) return

      const event = purchaseEvent()
      await postEvent(event)
      const productChanged = { ...event, product_id: 'premium_annual' }
      const replay = await postEvent(productChanged)

      expect(replay.status).toBe(200)
      const rows = await prisma.billingEvent.findMany({
        where: { external_event_id: event.id },
      })
      expect(rows).toHaveLength(1)
      // The replay's divergent content changed nothing.
      expect((await entitlementOf(subscriberId))?.product_id).toBe('premium_monthly')
    })

    it('5.2-INT-011: a strictly-older event records but does not transition', async (context) => {
      if (!requireSchema(context)) return

      const base = purchaseEvent()
      await postEvent(base)

      const older = purchaseEvent({
        type: 'PRODUCT_CHANGE',
        product_id: 'premium_annual',
        event_timestamp_ms: base.event_timestamp_ms - 60_000,
      })
      const response = await postEvent(older)

      expect(response.status).toBe(200)
      // Recorded as a billing fact...
      expect(
        await prisma.billingEvent.count({ where: { external_event_id: older.id } })
      ).toBe(1)
      // ...but the mirror still reflects the newer base event.
      expect((await entitlementOf(subscriberId))?.product_id).toBe('premium_monthly')
    })

    it('5.2-INT-012: an equal-timestamp DISTINCT event applies in arrival order', async (context) => {
      if (!requireSchema(context)) return

      const base = purchaseEvent({ type: 'RENEWAL' })
      await postEvent(base)

      // The real RC pair: RENEWAL + PRODUCT_CHANGE with identical occurred_at.
      const samInstant = purchaseEvent({
        type: 'PRODUCT_CHANGE',
        product_id: 'premium_annual',
        event_timestamp_ms: base.event_timestamp_ms,
      })
      const response = await postEvent(samInstant)

      expect(response.status).toBe(200)
      const row = await entitlementOf(subscriberId)
      expect(row?.product_id).toBe('premium_annual')
      expect(row?.last_event_id).toBe(samInstant.id)
    })

    it('5.2-INT-013: a strictly-newer event applies', async (context) => {
      if (!requireSchema(context)) return

      const base = purchaseEvent()
      await postEvent(base)

      const newer = purchaseEvent({
        type: 'PRODUCT_CHANGE',
        product_id: 'premium_annual',
        event_timestamp_ms: base.event_timestamp_ms + 60_000,
      })
      await postEvent(newer)

      expect((await entitlementOf(subscriberId))?.product_id).toBe('premium_annual')
    })
  })

  describe('5.2-API-010: the Decision 4 transition table, cell by cell', () => {
    type PriorStatus = 'none' | 'active' | 'grace_period' | 'expired' | 'revoked'
    const priorStatuses: readonly PriorStatus[] = [
      'none',
      'active',
      'grace_period',
      'expired',
      'revoked',
    ]

    type ExpectedCell =
      | {
          kind: 'transition'
          status: 'active' | 'grace_period' | 'expired'
          willRenew: boolean
        }
      | { kind: 'record-only' }

    const eventRows: readonly [string, ExpectedCell][] = [
      ['INITIAL_PURCHASE', { kind: 'transition', status: 'active', willRenew: true }],
      ['RENEWAL', { kind: 'transition', status: 'active', willRenew: true }],
      ['PRODUCT_CHANGE', { kind: 'transition', status: 'active', willRenew: true }],
      ['CANCELLATION', { kind: 'transition', status: 'active', willRenew: false }],
      ['UNCANCELLATION', { kind: 'transition', status: 'active', willRenew: true }],
      ['BILLING_ISSUE', { kind: 'transition', status: 'grace_period', willRenew: true }],
      ['EXPIRATION', { kind: 'transition', status: 'expired', willRenew: false }],
      ['REFUND_REVERSED', { kind: 'transition', status: 'active', willRenew: true }],
      [
        'SUBSCRIPTION_EXTENDED',
        { kind: 'transition', status: 'active', willRenew: true },
      ],
      [
        'TEMPORARY_ENTITLEMENT_GRANT',
        { kind: 'transition', status: 'active', willRenew: true },
      ],
      ['SUBSCRIPTION_PAUSED', { kind: 'record-only' }],
      ['NON_RENEWING_PURCHASE', { kind: 'record-only' }],
      ['TEST', { kind: 'record-only' }],
      ['SOME_UNKNOWN_FUTURE_TYPE', { kind: 'record-only' }],
    ]

    /** The AC 6 emission rules, restated for the assertion side. */
    function expectedEmission(
      from: PriorStatus,
      to: 'active' | 'grace_period' | 'expired'
    ): 'activated' | 'deactivated' | null {
      if (from === to) return null
      if (
        to === 'active' &&
        (from === 'none' || from === 'expired' || from === 'revoked')
      ) {
        return 'activated'
      }
      if (to === 'expired') return 'deactivated'
      return null
    }

    for (const [type, cell] of eventRows) {
      // Dynamic registration instead of it.each: the vitest TestContext (for
      // the schema-missing skip) is only passed on the plain signature.
      registerRow(type, cell)
    }

    function registerRow(type: string, cell: ExpectedCell): void {
      it(`${type} row holds for every prior status`, async (context) => {
        if (!requireSchema(context)) return

        for (const prior of priorStatuses) {
          if (prior === 'none') {
            await prisma.premiumEntitlement.deleteMany({
              where: { user_id: subscriberId },
            })
          } else {
            await seedEntitlement(subscriberId, prior)
          }
          telemetry.captureEvent.mockClear()
          const auditsBefore = await auditCount(subscriberId)

          const event = purchaseEvent({ type })
          const response = await postEvent(event)
          expect(response.status, `${type} from ${prior}`).toBe(200)
          expect(response.body).toEqual({ data: { received: true } })

          // Every authenticated event records, transition or not.
          expect(
            await prisma.billingEvent.count({ where: { external_event_id: event.id } }),
            `${type} from ${prior}: BillingEvent recorded`
          ).toBe(1)

          const row = await entitlementOf(subscriberId)
          const auditsAfter = await auditCount(subscriberId)

          if (cell.kind === 'record-only') {
            if (prior === 'none') {
              expect(row, `${type} from none: no row invented`).toBeNull()
            } else {
              expect(row?.status, `${type} from ${prior}: status untouched`).toBe(prior)
              expect(row?.product_id, `${type} from ${prior}: product untouched`).toBe(
                'premium_seeded'
              )
            }
            expect(auditsAfter, `${type} from ${prior}: no audit row`).toBe(auditsBefore)
            expect(
              telemetry.captureEvent,
              `${type} from ${prior}: no telemetry`
            ).not.toHaveBeenCalled()
            continue
          }

          expect(row?.status, `${type} from ${prior}: status`).toBe(cell.status)
          expect(row?.will_renew, `${type} from ${prior}: willRenew`).toBe(cell.willRenew)
          expect(row?.product_id, `${type} from ${prior}: product`).toBe(
            'premium_monthly'
          )
          expect(row?.store, `${type} from ${prior}: store`).toBe('app_store')
          expect(
            row?.current_period_end.toISOString(),
            `${type} from ${prior}: period end`
          ).toBe(PERIOD_END.toISOString())
          expect(row?.last_event_id, `${type} from ${prior}: cursor`).toBe(event.id)

          const statusChanged = prior !== cell.status
          expect(auditsAfter - auditsBefore, `${type} from ${prior}: audit rows`).toBe(
            statusChanged ? 1 : 0
          )

          const emission = expectedEmission(prior, cell.status)
          if (emission === 'activated') {
            expect(telemetry.captureEvent, `${type} from ${prior}`).toHaveBeenCalledWith(
              subscriberId,
              'premium_entitlement_activated',
              { store: 'app_store', productId: 'premium_monthly' }
            )
          } else if (emission === 'deactivated') {
            expect(telemetry.captureEvent, `${type} from ${prior}`).toHaveBeenCalledWith(
              subscriberId,
              'premium_entitlement_deactivated',
              { store: 'app_store', productId: 'premium_monthly', reason: 'expired' }
            )
          } else {
            expect(
              telemetry.captureEvent,
              `${type} from ${prior}: grace entry/exit and lateral moves emit nothing`
            ).not.toHaveBeenCalled()
          }
        }
      })
    }
  })

  describe('TRANSFER two-user semantics', () => {
    function transferEvent(overrides: Partial<RcEventInput> = {}): RcEventInput {
      return {
        id: nextEventId(),
        type: 'TRANSFER',
        event_timestamp_ms: T0 + eventSequence * 1000,
        store: 'APP_STORE',
        product_id: 'premium_monthly',
        expiration_at_ms: PERIOD_END.getTime(),
        transferred_from: [subscriberId],
        transferred_to: [gainerId],
        ...overrides,
      }
    }

    it('revokes the loser and activates the gainer in one transaction, with both emissions', async (context) => {
      if (!requireSchema(context)) return

      await seedEntitlement(subscriberId, 'active')

      const response = await postEvent(transferEvent())
      expect(response.status).toBe(200)

      const loser = await entitlementOf(subscriberId)
      expect(loser?.status).toBe('revoked')
      const gainer = await entitlementOf(gainerId)
      expect(gainer).toMatchObject({
        status: 'active',
        product_id: 'premium_monthly',
        will_renew: true,
      })

      // TRANSFER-loss carries reason 'transferred'; TRANSFER-gain is the
      // absent→active activation.
      expect(telemetry.captureEvent).toHaveBeenCalledWith(
        subscriberId,
        'premium_entitlement_deactivated',
        expect.objectContaining({ reason: 'transferred' })
      )
      expect(telemetry.captureEvent).toHaveBeenCalledWith(
        gainerId,
        'premium_entitlement_activated',
        expect.objectContaining({ productId: 'premium_monthly' })
      )
    })

    it('skips a losing user with no local entitlement row silently', async (context) => {
      if (!requireSchema(context)) return

      const response = await postEvent(transferEvent())

      expect(response.status).toBe(200)
      expect(await entitlementOf(subscriberId)).toBeNull()
      expect((await entitlementOf(gainerId))?.status).toBe('active')
    })

    it('records with user_id null and writes no entitlement when the gainer is unknown', async (context) => {
      if (!requireSchema(context)) return

      await seedEntitlement(subscriberId, 'active')
      const event = transferEvent({
        transferred_to: [`${namespace}-unknown-user`],
      })

      const response = await postEvent(event)

      expect(response.status).toBe(200)
      const recorded = await prisma.billingEvent.findFirst({
        where: { external_event_id: event.id },
      })
      expect(recorded?.user_id).toBeNull()
      // The loser still lost — RC has already moved the subscription.
      expect((await entitlementOf(subscriberId))?.status).toBe('revoked')
    })
  })

  describe('unknown subjects and degraded sinks', () => {
    it('5.2-INT-040: an unknown app_user_id answers 200, records user_id null, writes no entitlement, emits no api_error_occurred', async (context) => {
      if (!requireSchema(context)) return

      const event = purchaseEvent({ app_user_id: `${namespace}-ghost` })
      const response = await postEvent(event)

      expect(response.status).toBe(200)
      const recorded = await prisma.billingEvent.findFirst({
        where: { external_event_id: event.id },
      })
      expect(recorded).not.toBeNull()
      expect(recorded?.user_id).toBeNull()
      expect(
        await prisma.premiumEntitlement.count({
          where: { user_id: { in: [subscriberId, gainerId] } },
        })
      ).toBe(0)
      const apiErrorCalls = telemetry.captureEvent.mock.calls.filter(
        ([, eventType]) => eventType === 'api_error_occurred'
      )
      expect(apiErrorCalls).toHaveLength(0)
    })

    it('5.2-INT-043: a downed telemetry sink cannot fail the webhook or the transition', async (context) => {
      if (!requireSchema(context)) return

      telemetry.captureEvent.mockRejectedValue(new Error('posthog is down'))

      const response = await postEvent(purchaseEvent())

      expect(response.status).toBe(200)
      expect((await entitlementOf(subscriberId))?.status).toBe('active')
    })
  })
})

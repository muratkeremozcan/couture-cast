import 'reflect-metadata'
import { randomUUID } from 'node:crypto'
import { PrismaClient } from '@prisma/client'
import {
  Controller,
  Get,
  UnauthorizedException,
  UseGuards,
  type INestApplication,
} from '@nestjs/common'
import { Test, type TestingModule } from '@nestjs/testing'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildPremiumEntitlementCreateInput,
  createPremiumEntitlement,
} from '@couture/testing'
import {
  PREMIUM_REQUIRED_MESSAGE,
  SUBSCRIPTION_LEDGER_UNAVAILABLE_MESSAGE,
} from '../src/contracts/http.js'
import { RequestAuthGuard } from '../src/modules/auth/security.guards.js'
import type { AuthenticatedRequest } from '../src/modules/auth/security.types.js'
import { CommerceModule } from '../src/modules/commerce/commerce.module.js'
import { PremiumEntitlementGuard } from '../src/modules/commerce/premium-entitlement.guard.js'
import { PremiumEntitlementService } from '../src/modules/commerce/premium-entitlement.service.js'
import {
  FakeRevenueCatClient,
  RevenueCatClient,
} from '../src/modules/commerce/revenuecat-client.js'
import { SubscriptionService } from '../src/modules/commerce/subscription.service.js'
import { FeatureFlagsWarmup } from '../src/modules/feature-flags/feature-flags.warmup.js'
import { FeatureFlagsService } from '../src/modules/feature-flags/feature-flags.service.js'

/**
 * Story 5.2 Task 3: the entitlement core over real PostgreSQL and real HTTP.
 *
 * HTTP-visible behaviour gets HTTP assertions (the Story 4.4 lesson): the
 * guard's 401/403/200 paths, the status endpoint's `none` serialization, the
 * refresh endpoint's 503 and rate-limit semantics, and the cross-user
 * authorization story are all proven through a Nest `TestingModule` compiled
 * from the REAL `CommerceModule`, so route paths, guards, and providers are
 * wired as deployed.
 *
 * The guard's fixture controller below is registered in the TestingModule
 * ONLY, never in CommerceModule — 5.2-API-015 asserts exactly that, because a
 * fixture route that leaked into the production route table would be an
 * unauthenticated-premium bypass shipped to prod.
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
      '[premium-subscription.integration] Skipped: PostgreSQL is missing the Story 5.2 billing schema. ' +
        'Run `npm run db:migrate` to execute this suite.'
    )
  }
}

/** Typed view over a supertest body so assertions stay lint-clean. */
type ResponseEnvelope = {
  data: Record<string, unknown> & { status?: string }
  message?: string
}

function envelope(response: { body: unknown }): ResponseEnvelope {
  return response.body as ResponseEnvelope
}

function requireSchema(context: { skip: () => void }): boolean {
  if (!schemaReady) {
    context.skip()
    return false
  }
  return true
}

/**
 * TestingModule-ONLY consumer proving the guard over HTTP. CC-5.5's planner
 * API will be the first production consumer; until then the guard ships tested
 * but dormant, and this is where the testing happens.
 */
@Controller('/api/v1/premium-fixture')
@UseGuards(RequestAuthGuard, PremiumEntitlementGuard)
class PremiumFixtureController {
  @Get()
  read(): { data: { ok: true } } {
    return { data: { ok: true } }
  }
}

describe('5.2 premium entitlement core against real PostgreSQL and real HTTP', () => {
  // File-private namespace: user-scoped rows make partitioning by user enough
  // to survive parallel Vitest, but event ids must stay file-private too.
  const namespace = `premium-core-${randomUUID().slice(0, 8)}`
  /** Anchors the pseudonymous-telemetry cleanup in afterAll; see the comment there. */
  const suiteStartedAt = new Date()

  let app: INestApplication | undefined
  let subscriberId: string
  let bystanderId: string
  let fakeLedger: FakeRevenueCatClient

  const featureFlags = { getFeatureFlag: vi.fn() }

  const tokenFor = (userId: string) => `Bearer premium-test:${userId}`

  function get(path: string, userId?: string) {
    if (!app) {
      throw new Error('App is not initialized')
    }
    const req = request(app.getHttpServer() as Parameters<typeof request>[0]).get(path)
    return userId ? req.set({ authorization: tokenFor(userId) }) : req
  }

  function postRefresh(userId: string) {
    if (!app) {
      throw new Error('App is not initialized')
    }
    return request(app.getHttpServer() as Parameters<typeof request>[0])
      .post('/api/v1/commerce/subscription/refresh')
      .set({ authorization: tokenFor(userId) })
  }

  /**
   * Upsert rather than create: the guard matrix walks every status against the
   * same user without clearing between iterations. The row is built by the
   * story's own factory so the pinned instants and defaults live in one place,
   * and both upsert branches are derived from it rather than restated.
   */
  async function seedEntitlement(
    userId: string,
    status: 'active' | 'grace_period' | 'expired' | 'revoked'
  ): Promise<void> {
    const data = buildPremiumEntitlementCreateInput(
      createPremiumEntitlement({
        userId,
        status,
        willRenew: status === 'active' || status === 'grace_period',
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

  async function clearEntitlement(userId: string): Promise<void> {
    await prisma.premiumEntitlement.deleteMany({ where: { user_id: userId } })
  }

  beforeAll(async () => {
    await probeSchema()
    if (!schemaReady) return

    const subscriber = await prisma.user.create({
      data: { email: `${namespace}-subscriber@synthetic.test` },
    })
    subscriberId = subscriber.id
    const bystander = await prisma.user.create({
      data: { email: `${namespace}-bystander@synthetic.test` },
    })
    bystanderId = bystander.id

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [CommerceModule],
      controllers: [PremiumFixtureController],
    })
      .overrideProvider(PrismaClient)
      .useValue(prisma)
      .overrideProvider(FeatureFlagsService)
      .useValue(featureFlags)
      .overrideProvider(FeatureFlagsWarmup)
      .useValue({ onModuleInit: () => Promise.resolve() })
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

    app = moduleFixture.createNestApplication()
    await app.init()

    const client = app.get(RevenueCatClient)
    if (!(client instanceof FakeRevenueCatClient)) {
      throw new Error(
        'Expected the fake RevenueCat client under allowsTestOnlySecrets; check NODE_ENV/TEST_ENV.'
      )
    }
    fakeLedger = client
  })

  beforeEach(async () => {
    featureFlags.getFeatureFlag.mockReset().mockResolvedValue(false)
    fakeLedger?.reset()
    app?.get(SubscriptionService).resetRefreshThrottle()
    if (schemaReady) {
      await clearEntitlement(subscriberId)
      await clearEntitlement(bystanderId)
    }
  })

  afterAll(async () => {
    if (app) {
      await app.close()
    }
    if (schemaReady) {
      // Bounded by the suite's start instant, NOT by user id. Both premium
      // entitlement events are in PSEUDONYMOUS_EVENT_TYPES, so TelemetryService
      // persists them with `user_id: null` on purpose — a `user_id: { in: [...] }`
      // filter would match zero rows and silently leave the cleanup doing
      // nothing. An event_type-only filter is the opposite failure: it reaches
      // rows a parallel suite or the seed wrote to this shared database. The
      // time anchor is the same compromise `cleanupScopeStartedAt` makes in
      // packages/testing/src/cleanup.ts for exactly this class of unowned row.
      await prisma.telemetryEvent.deleteMany({
        where: {
          event_type: {
            in: ['premium_entitlement_activated', 'premium_entitlement_deactivated'],
          },
          created_at: { gte: suiteStartedAt },
        },
      })
      await prisma.premiumEntitlement.deleteMany({
        where: { user_id: { in: [subscriberId, bystanderId] } },
      })
      // The suite's users are NOT deleted, deliberately. Entitlement
      // transitions wrote AuditLog rows, the audit trail is immutable by
      // trigger (DELETE raises 42501), and AuditLog->User is RESTRICT — so a
      // user who earned audit rows is undeletable by design. The users are
      // namespaced synthetics on a disposable database.
    }
    await prisma.$disconnect()
  })

  describe('status endpoint', () => {
    it('5.2-INT-003 serializes never-subscribed as status none with null keys present', async (context) => {
      if (!requireSchema(context)) return

      const response = await get('/api/v1/commerce/subscription', subscriberId)

      expect(response.status).toBe(200)
      expect(response.body).toEqual({
        data: {
          status: 'none',
          store: null,
          productId: null,
          willRenew: null,
          currentPeriodEnd: null,
          syncedAt: null,
          purchasesEnabled: false,
        },
      })
    })

    it('5.2-INT-004 reflects the entitlement mirror and the server-evaluated flag', async (context) => {
      if (!requireSchema(context)) return

      await seedEntitlement(subscriberId, 'active')
      featureFlags.getFeatureFlag.mockResolvedValue(true)

      const response = await get('/api/v1/commerce/subscription', subscriberId)

      expect(response.status).toBe(200)
      expect(envelope(response).data).toMatchObject({
        status: 'active',
        store: 'stripe',
        productId: 'premium_monthly',
        willRenew: true,
        purchasesEnabled: true,
      })
      expect(featureFlags.getFeatureFlag).toHaveBeenCalledWith(
        'commerce_subscription_enabled',
        subscriberId
      )
    })

    it('5.2-INT-005 rejects an unauthenticated read', async (context) => {
      if (!requireSchema(context)) return

      const response = await get('/api/v1/commerce/subscription')
      expect(response.status).toBe(401)
    })
  })

  describe('cross-user authorization (5.2-API-014)', () => {
    it('answers each token about its own subscription only, and exposes no id route', async (context) => {
      if (!requireSchema(context)) return

      await seedEntitlement(subscriberId, 'active')

      const own = await get('/api/v1/commerce/subscription', subscriberId)
      expect(envelope(own).data.status).toBe('active')

      // The bystander's token cannot see the subscriber's state...
      const other = await get('/api/v1/commerce/subscription', bystanderId)
      expect(envelope(other).data.status).toBe('none')

      // ...and there is no id-addressed route to ask about anyone else.
      const byId = await get(`/api/v1/commerce/subscription/${subscriberId}`, bystanderId)
      expect(byId.status).toBe(404)
    })
  })

  describe('refresh endpoint (5.2-INT-002)', () => {
    it('applies the ledger snapshot on demand and writes the audit row', async (context) => {
      if (!requireSchema(context)) return

      fakeLedger.setEntitlement(subscriberId, {
        status: 'active',
        store: 'app_store',
        productId: 'premium_annual',
        willRenew: true,
        currentPeriodEnd: new Date('2030-06-01T00:00:00.000Z'),
      })

      const response = await postRefresh(subscriberId)

      expect(response.status).toBe(200)
      expect(envelope(response).data).toMatchObject({
        status: 'active',
        store: 'app_store',
        productId: 'premium_annual',
      })

      const row = await prisma.premiumEntitlement.findUnique({
        where: { user_id: subscriberId },
      })
      expect(row?.status).toBe('active')
      expect(row?.last_event_id.startsWith('pull:')).toBe(true)

      const audit = await prisma.auditLog.findMany({
        where: { user_id: subscriberId, event_type: 'premium_entitlement_changed' },
      })
      expect(audit).toHaveLength(1)
      expect(audit[0]?.event_data).toMatchObject({ from: 'none', to: 'active' })
    })

    it('answers 503 with the ledger-unavailable message when the pull fails', async (context) => {
      if (!requireSchema(context)) return

      fakeLedger.failNextCall()

      const response = await postRefresh(subscriberId)

      expect(response.status).toBe(503)
      expect(envelope(response).message).toBe(SUBSCRIPTION_LEDGER_UNAVAILABLE_MESSAGE)
    })

    it('serves local state inside the 10-second window instead of re-hammering the ledger', async (context) => {
      if (!requireSchema(context)) return

      fakeLedger.setEntitlement(subscriberId, {
        status: 'active',
        store: 'stripe',
        productId: 'premium_monthly',
        willRenew: true,
        currentPeriodEnd: new Date('2030-01-01T00:00:00.000Z'),
      })
      const first = await postRefresh(subscriberId)
      expect(first.status).toBe(200)

      // If the second refresh touched the ledger at all, this would 503; the
      // 200 with the same state proves the window served the local mirror.
      fakeLedger.failNextCall()
      const second = await postRefresh(subscriberId)
      expect(second.status).toBe(200)
      expect(envelope(second).data.status).toBe('active')
    })

    it('applies a ledger-asserted downgrade (drift correction path)', async (context) => {
      if (!requireSchema(context)) return

      await seedEntitlement(subscriberId, 'active')
      // Ledger reports no entitlement: the mirror must follow, not argue.
      fakeLedger.setEntitlement(subscriberId, null)

      const response = await postRefresh(subscriberId)

      expect(response.status).toBe(200)
      expect(envelope(response).data).toMatchObject({
        status: 'expired',
        willRenew: false,
      })
    })
  })

  describe('premium guard over HTTP (5.2-API-011)', () => {
    it('passes active and grace_period, denies expired, revoked, and absent', async (context) => {
      if (!requireSchema(context)) return

      const expectations = [
        { status: 'active', expected: 200 },
        { status: 'grace_period', expected: 200 },
        { status: 'expired', expected: 403 },
        { status: 'revoked', expected: 403 },
      ] as const

      for (const { status, expected } of expectations) {
        await seedEntitlement(subscriberId, status)
        const response = await get('/api/v1/premium-fixture', subscriberId)
        expect(response.status, `status ${status}`).toBe(expected)
        if (expected === 403) {
          expect(envelope(response).message).toBe(PREMIUM_REQUIRED_MESSAGE)
        }
      }

      await clearEntitlement(subscriberId)
      const absent = await get('/api/v1/premium-fixture', subscriberId)
      expect(absent.status).toBe(403)
      expect(envelope(absent).message).toBe(PREMIUM_REQUIRED_MESSAGE)
    })

    it('answers 401, not 403, for a missing token', async (context) => {
      if (!requireSchema(context)) return

      const response = await get('/api/v1/premium-fixture')
      expect(response.status).toBe(401)
    })

    it('5.2-API-015 keeps the fixture controller out of the production module', () => {
      const controllers = (Reflect.getMetadata('controllers', CommerceModule) ??
        []) as unknown[]
      expect(controllers).not.toContain(PremiumFixtureController)
    })
  })

  describe('ordering guard (Decision 8, service level)', () => {
    const state = (productId: string) => ({
      status: 'active' as const,
      store: 'stripe' as const,
      productId,
      willRenew: true,
      currentPeriodEnd: new Date('2030-01-01T00:00:00.000Z'),
    })

    it('drops strictly-older events, applies equal-distinct and newer events', async (context) => {
      if (!requireSchema(context)) return

      const service = app?.get(PremiumEntitlementService)
      if (!service) throw new Error('App is not initialized')

      const t0 = new Date('2026-08-10T10:00:00.000Z')
      const apply = (
        occurredAt: Date,
        eventId: string,
        productId: string
      ): ReturnType<PremiumEntitlementService['applyLedgerEvent']> =>
        prisma.$transaction((tx) =>
          service.applyLedgerEvent(tx, {
            userId: subscriberId,
            state: state(productId),
            occurredAt,
            eventId: `${namespace}-${eventId}`,
            provider: 'revenuecat',
          })
        )

      // Baseline.
      expect((await apply(t0, 'base', 'premium_monthly')).applied).toBe(true)

      // Strictly older: dropped, state untouched.
      const older = await apply(new Date(t0.getTime() - 1000), 'older', 'premium_annual')
      expect(older.applied).toBe(false)
      let row = await prisma.premiumEntitlement.findUnique({
        where: { user_id: subscriberId },
      })
      expect(row?.product_id).toBe('premium_monthly')

      // Equal occurred_at, DISTINCT event id: applied in arrival order — the
      // RENEWAL + PRODUCT_CHANGE same-instant pair RevenueCat really emits.
      const equalDistinct = await apply(t0, 'equal-distinct', 'premium_annual')
      expect(equalDistinct.applied).toBe(true)

      // Equal occurred_at, SAME event id: the replay case, dropped.
      const equalSame = await apply(t0, 'equal-distinct', 'premium_monthly')
      expect(equalSame.applied).toBe(false)
      row = await prisma.premiumEntitlement.findUnique({
        where: { user_id: subscriberId },
      })
      expect(row?.product_id).toBe('premium_annual')

      // Strictly newer: applied.
      const newer = await apply(new Date(t0.getTime() + 1000), 'newer', 'premium_monthly')
      expect(newer.applied).toBe(true)
    })
  })
})

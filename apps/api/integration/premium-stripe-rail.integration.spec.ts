import 'reflect-metadata'
import { randomUUID } from 'node:crypto'
import { PrismaClient } from '@prisma/client'
import { UnauthorizedException, type INestApplication } from '@nestjs/common'
import { HttpAdapterHost } from '@nestjs/core'
import { Test, type TestingModule } from '@nestjs/testing'
import request from 'supertest'
import Stripe from 'stripe'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildBillingCustomerCreateInput,
  buildPremiumEntitlementCreateInput,
  createBillingCustomer,
  createPremiumEntitlement,
} from '@couture/testing'
import {
  BILLING_WEBHOOK_UNAUTHORIZED_MESSAGE,
  COMMERCE_SUBSCRIPTION_DISABLED_MESSAGE,
  SUBSCRIPTION_ALREADY_ACTIVE_MESSAGE,
  SUBSCRIPTION_NOT_FOUND_MESSAGE,
  SUBSCRIPTION_NOT_WEB_MANAGED_MESSAGE,
} from '../src/contracts/http.js'
import { ApiExceptionFilter } from '../src/filters/api-exception.filter.js'
import { RequestAuthGuard } from '../src/modules/auth/security.guards.js'
import type { AuthenticatedRequest } from '../src/modules/auth/security.types.js'
import { STRIPE_WEBHOOK_ROUTE } from '../src/modules/commerce/billing-webhook.controller.js'
import { buildTestOnlyStripeWebhookSecret } from '../src/modules/commerce/billing-webhook.service.js'
import { CommerceModule } from '../src/modules/commerce/commerce.module.js'
import {
  FakeRevenueCatClient,
  RevenueCatClient,
} from '../src/modules/commerce/revenuecat-client.js'
import {
  FakeStripeBillingClient,
  StripeBillingClient,
} from '../src/modules/commerce/stripe-client.js'
import { FeatureFlagsCron } from '../src/modules/feature-flags/feature-flags.cron.js'
import { FeatureFlagsService } from '../src/modules/feature-flags/feature-flags.service.js'
import { TelemetryService } from '../src/modules/telemetry/telemetry.service.js'

/**
 * Story 5.2 Task 4: the Stripe rail over real PostgreSQL and real HTTP.
 *
 * Covers: the checkout-session status precedence (5.2-INT-030 kill switch over
 * schema; 409; 500), portal-session 201/404/409 and its ungated-ness
 * (5.2-INT-032), the signature quartet over HTTP with fixtures signed by the
 * REAL stripe library's `generateTestHeaderString` (5.2-INT-020..023 — the
 * verifier is never faked, per Decision 9), the forward outbox
 * (5.2-INT-024/026), webhooks-record-when-flag-off (5.2-INT-031), and the
 * unknown-customer contract (5.2-INT-041).
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
    await prisma.$queryRaw`SELECT 1 FROM "BillingCustomer" LIMIT 1`
    await prisma.$queryRaw`SELECT 1 FROM "BillingEvent" LIMIT 1`
    schemaReady = true
  } catch {
    schemaReady = false
    // eslint-disable-next-line no-console
    console.warn(
      '[premium-stripe-rail.integration] Skipped: PostgreSQL is missing the Story 5.2 billing schema. ' +
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

/** Signing helper: the REAL stripe library, exactly what the server verifies with. */
const stripeSigner = new Stripe('sk_test_signing_helper_only')

/**
 * The far-future period end every premium fixture shares, in both shapes it is
 * needed: a Date for our own columns and Unix seconds for Stripe payloads,
 * which is what Stripe actually sends. Derived rather than written twice so the
 * two can never drift, and so no reader has to decode 1893456000 by hand.
 */
const PERIOD_END = new Date('2030-01-01T00:00:00.000Z')
const PERIOD_END_EPOCH_SECONDS = PERIOD_END.getTime() / 1000

function signStripePayload(
  payload: string,
  options: { secret?: string; timestamp?: number } = {}
): string {
  return stripeSigner.webhooks.generateTestHeaderString({
    payload,
    secret: options.secret ?? buildTestOnlyStripeWebhookSecret(),
    ...(options.timestamp === undefined ? {} : { timestamp: options.timestamp }),
  })
}

type StripeEventFixture = {
  id: string
  object: 'event'
  type: string
  created: number
  livemode: boolean
  api_version: string
  data: { object: Record<string, unknown> }
}

describe('5.2 Stripe rail against real PostgreSQL and real HTTP', () => {
  const namespace = `stripe52-${randomUUID().slice(0, 8)}`
  let eventSequence = 0
  const nextEventId = () => `${namespace}_evt_${(eventSequence += 1)}`

  let app: INestApplication | undefined
  let buyerId: string
  let fakeStripe: FakeStripeBillingClient
  let fakeLedger: FakeRevenueCatClient

  const featureFlags = { getFeatureFlag: vi.fn() }
  const telemetry = { captureEvent: vi.fn() }

  const tokenFor = (userId: string) => `Bearer premium-test:${userId}`

  function httpServer() {
    if (!app) {
      throw new Error('App is not initialized')
    }
    return app.getHttpServer() as Parameters<typeof request>[0]
  }

  function checkoutEventFixture(
    overrides: Partial<StripeEventFixture['data']['object']> = {}
  ): StripeEventFixture {
    return {
      id: nextEventId(),
      object: 'event',
      type: 'checkout.session.completed',
      created: Math.floor(Date.now() / 1000),
      livemode: false,
      api_version: '2026-07-29.dahlia',
      data: {
        object: {
          id: `cs_${namespace}`,
          object: 'checkout.session',
          client_reference_id: buyerId,
          customer: `cus_${namespace}`,
          subscription: `sub_${namespace}`,
          metadata: { userId: buyerId, plan: 'premium_monthly' },
          ...overrides,
        },
      },
    }
  }

  function postSigned(payload: string, signature: string) {
    return request(httpServer())
      .post(STRIPE_WEBHOOK_ROUTE)
      .set('content-type', 'application/json')
      .set('stripe-signature', signature)
      .send(payload)
  }

  async function billingEventOf(externalEventId: string) {
    return prisma.billingEvent.findUnique({
      where: {
        provider_external_event_id: {
          provider: 'stripe',
          external_event_id: externalEventId,
        },
      },
    })
  }

  beforeAll(async () => {
    await probeSchema()
    if (!schemaReady) return

    const buyer = await prisma.user.create({
      data: { email: `${namespace}-buyer@synthetic.test` },
    })
    buyerId = buyer.id

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [CommerceModule],
    })
      .overrideProvider(PrismaClient)
      .useValue(prisma)
      .overrideProvider(FeatureFlagsService)
      .useValue(featureFlags)
      .overrideProvider(FeatureFlagsCron)
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

    app = moduleFixture.createNestApplication({ rawBody: true })
    app.useGlobalFilters(
      new ApiExceptionFilter(
        app.get(HttpAdapterHost),
        telemetry as unknown as TelemetryService
      )
    )
    await app.init()

    const stripeClient = app.get(StripeBillingClient)
    if (!(stripeClient instanceof FakeStripeBillingClient)) {
      throw new Error(
        'Expected the fake Stripe client under allowsTestOnlySecrets; check NODE_ENV/TEST_ENV.'
      )
    }
    fakeStripe = stripeClient

    const ledger = app.get(RevenueCatClient)
    if (!(ledger instanceof FakeRevenueCatClient)) {
      throw new Error(
        'Expected the fake RevenueCat client under allowsTestOnlySecrets; check NODE_ENV/TEST_ENV.'
      )
    }
    fakeLedger = ledger
  })

  beforeEach(async () => {
    featureFlags.getFeatureFlag.mockReset().mockResolvedValue(true)
    telemetry.captureEvent.mockReset().mockResolvedValue(undefined)
    fakeStripe?.reset()
    fakeLedger?.reset()
    if (schemaReady) {
      await prisma.premiumEntitlement.deleteMany({ where: { user_id: buyerId } })
      await prisma.billingCustomer.deleteMany({ where: { user_id: buyerId } })
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
      await prisma.premiumEntitlement.deleteMany({ where: { user_id: buyerId } })
      await prisma.billingCustomer.deleteMany({ where: { user_id: buyerId } })
      await prisma.user.deleteMany({ where: { id: buyerId } })
    }
    await prisma.$disconnect()
  })

  describe('checkout-session status precedence (Decision 4)', () => {
    it('5.2-INT-030: the 503 kill switch outranks even an invalid body', async (context) => {
      if (!requireSchema(context)) return

      featureFlags.getFeatureFlag.mockResolvedValue(false)

      const response = await request(httpServer())
        .post('/api/v1/commerce/subscription/checkout-session')
        .set('authorization', tokenFor(buyerId))
        .send({ plan: 'not-a-real-plan' })

      expect(response.status).toBe(503)
      expect((response.body as { message?: string }).message).toBe(
        COMMERCE_SUBSCRIPTION_DISABLED_MESSAGE
      )
    })

    it('answers 400 from the schema for an unknown plan once the flag is on', async (context) => {
      if (!requireSchema(context)) return

      const response = await request(httpServer())
        .post('/api/v1/commerce/subscription/checkout-session')
        .set('authorization', tokenFor(buyerId))
        .send({ plan: 'premium_lifetime' })

      expect(response.status).toBe(400)
    })

    it('answers 409 for an already-active subscriber', async (context) => {
      if (!requireSchema(context)) return

      await prisma.premiumEntitlement.create({
        data: buildPremiumEntitlementCreateInput(
          createPremiumEntitlement({
            userId: buyerId,
            status: 'active',
            lastEventId: `${namespace}-seed`,
          })
        ),
      })

      const response = await request(httpServer())
        .post('/api/v1/commerce/subscription/checkout-session')
        .set('authorization', tokenFor(buyerId))
        .send({ plan: 'premium_monthly' })

      expect(response.status).toBe(409)
      expect((response.body as { message?: string }).message).toBe(
        SUBSCRIPTION_ALREADY_ACTIVE_MESSAGE
      )
    })

    it('creates the session, upserts BillingCustomer, and emits premium_checkout_started', async (context) => {
      if (!requireSchema(context)) return

      const response = await request(httpServer())
        .post('/api/v1/commerce/subscription/checkout-session')
        .set('authorization', tokenFor(buyerId))
        .send({ plan: 'premium_monthly' })

      expect(response.status).toBe(201)
      const url = (response.body as { data: { url: string } }).data.url
      expect(url).toContain('https://checkout.stripe.test/')

      // Customer created-or-reused AT SESSION TIME, not webhook time: an
      // abandoned checkout still leaves a portal-capable customer.
      const customer = await prisma.billingCustomer.findUnique({
        where: { user_id: buyerId },
      })
      expect(customer).not.toBeNull()

      expect(fakeStripe.checkoutSessions[0]).toMatchObject({
        userId: buyerId,
        plan: 'premium_monthly',
      })
      expect(telemetry.captureEvent).toHaveBeenCalledWith(
        buyerId,
        'premium_checkout_started',
        { plan: 'premium_monthly' }
      )
    })

    it('turns a Stripe API failure into the honest 500', async (context) => {
      if (!requireSchema(context)) return

      fakeStripe.failNextCall()

      const response = await request(httpServer())
        .post('/api/v1/commerce/subscription/checkout-session')
        .set('authorization', tokenFor(buyerId))
        .send({ plan: 'premium_monthly' })

      expect(response.status).toBe(500)
    })
  })

  describe('portal-session (5.2-INT-032: never gated)', () => {
    it('answers 404 with no billing profile', async (context) => {
      if (!requireSchema(context)) return

      const response = await request(httpServer())
        .post('/api/v1/commerce/subscription/portal-session')
        .set('authorization', tokenFor(buyerId))

      expect(response.status).toBe(404)
      expect((response.body as { message?: string }).message).toBe(
        SUBSCRIPTION_NOT_FOUND_MESSAGE
      )
    })

    it('answers 409 for a store-managed subscription', async (context) => {
      if (!requireSchema(context)) return

      await prisma.billingCustomer.create({
        data: buildBillingCustomerCreateInput(
          createBillingCustomer({
            userId: buyerId,
            stripeCustomerId: `cus_${namespace}_409`,
          })
        ),
      })
      await prisma.premiumEntitlement.create({
        data: buildPremiumEntitlementCreateInput(
          createPremiumEntitlement({
            userId: buyerId,
            status: 'active',
            // The 409 turns on this field alone: a store-managed subscription
            // has no Stripe portal to send the user to.
            store: 'app_store',
            lastEventId: `${namespace}-seed-409`,
          })
        ),
      })

      const response = await request(httpServer())
        .post('/api/v1/commerce/subscription/portal-session')
        .set('authorization', tokenFor(buyerId))

      expect(response.status).toBe(409)
      expect((response.body as { message?: string }).message).toBe(
        SUBSCRIPTION_NOT_WEB_MANAGED_MESSAGE
      )
    })

    it('serves the portal with the kill switch OFF — a paying user can always cancel', async (context) => {
      if (!requireSchema(context)) return

      featureFlags.getFeatureFlag.mockResolvedValue(false)
      await prisma.billingCustomer.create({
        data: buildBillingCustomerCreateInput(
          createBillingCustomer({
            userId: buyerId,
            stripeCustomerId: `cus_${namespace}_ok`,
          })
        ),
      })

      const response = await request(httpServer())
        .post('/api/v1/commerce/subscription/portal-session')
        .set('authorization', tokenFor(buyerId))

      expect(response.status).toBe(201)
      expect((response.body as { data: { url: string } }).data.url).toContain(
        'https://portal.stripe.test/'
      )
    })
  })

  describe('webhook signature quartet (5.2-INT-020..023, real verifier)', () => {
    it('5.2-INT-020: a validly-signed event answers 200 and records', async (context) => {
      if (!requireSchema(context)) return

      const fixture = checkoutEventFixture()
      const payload = JSON.stringify(fixture)

      const response = await postSigned(payload, signStripePayload(payload))

      expect(response.status).toBe(200)
      expect(response.body).toEqual({ data: { received: true } })
      expect(await billingEventOf(fixture.id)).not.toBeNull()
    })

    it('5.2-INT-021: a tampered body answers the uniform 401', async (context) => {
      if (!requireSchema(context)) return

      const fixture = checkoutEventFixture()
      const payload = JSON.stringify(fixture)
      const signature = signStripePayload(payload)
      const tampered = payload.replace('premium_monthly', 'premium_annualX')

      const response = await postSigned(tampered, signature)

      expect(response.status).toBe(401)
      expect((response.body as { message?: string }).message).toBe(
        BILLING_WEBHOOK_UNAUTHORIZED_MESSAGE
      )
      expect(await billingEventOf(fixture.id)).toBeNull()
    })

    it('5.2-INT-022: a stale timestamp answers the identical 401', async (context) => {
      if (!requireSchema(context)) return

      const fixture = checkoutEventFixture()
      const payload = JSON.stringify(fixture)
      // 10 minutes old — past the stripe library's default 5-minute tolerance.
      const stale = signStripePayload(payload, {
        timestamp: Math.floor(Date.now() / 1000) - 600,
      })

      const response = await postSigned(payload, stale)

      expect(response.status).toBe(401)
      expect((response.body as { message?: string }).message).toBe(
        BILLING_WEBHOOK_UNAUTHORIZED_MESSAGE
      )
    })

    it('5.2-INT-023: a wrong secret answers the identical 401', async (context) => {
      if (!requireSchema(context)) return

      const fixture = checkoutEventFixture()
      const payload = JSON.stringify(fixture)
      const wrongSecret = signStripePayload(payload, {
        secret: 'whsec_the-wrong-signing-secret-entirely',
      })

      const response = await postSigned(payload, wrongSecret)

      expect(response.status).toBe(401)
      expect((response.body as { message?: string }).message).toBe(
        BILLING_WEBHOOK_UNAUTHORIZED_MESSAGE
      )
    })

    it('rejections on this route never emit api_error_occurred (excluded path)', async (context) => {
      if (!requireSchema(context)) return

      await postSigned('{}', 'not-a-signature')

      const apiErrorCalls = telemetry.captureEvent.mock.calls.filter(
        ([, eventType]) => eventType === 'api_error_occurred'
      )
      expect(apiErrorCalls).toHaveLength(0)
    })
  })

  describe('forward outbox (Decision 4: persist-then-attempt)', () => {
    it('a completed checkout forwards to the ledger inline and stamps the outbox', async (context) => {
      if (!requireSchema(context)) return

      const fixture = checkoutEventFixture()
      const payload = JSON.stringify(fixture)

      const response = await postSigned(payload, signStripePayload(payload))

      expect(response.status).toBe(200)
      const row = await billingEventOf(fixture.id)
      expect(row).toMatchObject({
        user_id: buyerId,
        forward_due: true,
        forward_attempts: 1,
        forward_last_error: null,
      })
      expect(row?.forwarded_at).not.toBeNull()
      expect(fakeLedger.getForwardedSubscription(buyerId)).toBe(`sub_${namespace}`)
    })

    it('5.2-INT-024: a failed forward still 200s and leaves the obligation due', async (context) => {
      if (!requireSchema(context)) return

      fakeLedger.failNextCall()
      const fixture = checkoutEventFixture()
      const payload = JSON.stringify(fixture)

      const response = await postSigned(payload, signStripePayload(payload))

      expect(response.status).toBe(200)
      const row = await billingEventOf(fixture.id)
      expect(row).toMatchObject({ forward_due: true, forwarded_at: null })
      expect(row?.forward_attempts).toBe(1)
      expect(row?.forward_last_error).toContain('simulated ledger outage')
    })

    it('5.2-INT-026: replays and redundant triggers stay idempotent end to end', async (context) => {
      if (!requireSchema(context)) return

      const fixture = checkoutEventFixture()
      const payload = JSON.stringify(fixture)
      await postSigned(payload, signStripePayload(payload))

      // Exact replay: one row, one forward.
      const replay = await postSigned(payload, signStripePayload(payload))
      expect(replay.status).toBe(200)
      expect(
        await prisma.billingEvent.count({
          where: { external_event_id: fixture.id },
        })
      ).toBe(1)

      // RC's recommended redundant trigger carries the same fetch token; the
      // fake asserts the same-token contract (no second subscription).
      const redundant: StripeEventFixture = {
        ...checkoutEventFixture(),
        type: 'customer.subscription.created',
        data: {
          object: {
            id: `sub_${namespace}`,
            object: 'subscription',
            customer: `cus_${namespace}`,
            metadata: { userId: buyerId, plan: 'premium_monthly' },
          },
        },
      }
      const redundantPayload = JSON.stringify(redundant)
      const second = await postSigned(
        redundantPayload,
        signStripePayload(redundantPayload)
      )
      expect(second.status).toBe(200)
      expect(fakeLedger.getForwardedSubscription(buyerId)).toBe(`sub_${namespace}`)
    })

    it('5.2-INT-031: webhooks record while the kill switch is off', async (context) => {
      if (!requireSchema(context)) return

      featureFlags.getFeatureFlag.mockResolvedValue(false)
      const fixture = checkoutEventFixture()
      const payload = JSON.stringify(fixture)

      const response = await postSigned(payload, signStripePayload(payload))

      expect(response.status).toBe(200)
      expect(await billingEventOf(fixture.id)).not.toBeNull()
    })

    it('5.2-INT-041: an unknown customer records user_id null, writes no entitlement, emits no api_error_occurred', async (context) => {
      if (!requireSchema(context)) return

      const fixture = checkoutEventFixture({
        client_reference_id: `${namespace}-ghost`,
        customer: 'cus_unknown_customer',
        metadata: {},
      })
      const payload = JSON.stringify(fixture)

      const response = await postSigned(payload, signStripePayload(payload))

      expect(response.status).toBe(200)
      const row = await billingEventOf(fixture.id)
      expect(row).not.toBeNull()
      expect(row?.user_id).toBeNull()
      // No user resolved → no forward obligation is satisfiable; the row
      // records the fact without pretending an outbox duty exists.
      expect(row?.forward_due).toBe(false)
      expect(await prisma.premiumEntitlement.count({ where: { user_id: buyerId } })).toBe(
        0
      )
      const apiErrorCalls = telemetry.captureEvent.mock.calls.filter(
        ([, eventType]) => eventType === 'api_error_occurred'
      )
      expect(apiErrorCalls).toHaveLength(0)
    })

    it('records lifecycle events without transitioning anything (one entitlement writer)', async (context) => {
      if (!requireSchema(context)) return

      const lifecycle: StripeEventFixture = {
        ...checkoutEventFixture(),
        type: 'customer.subscription.updated',
        data: {
          object: {
            id: `sub_${namespace}`,
            object: 'subscription',
            customer: `cus_${namespace}`,
            current_period_end: PERIOD_END_EPOCH_SECONDS,
            cancellation_details: { reason: 'cancellation_requested' },
            items: { data: [{ price: { lookup_key: 'premium_monthly' } }] },
            metadata: { userId: buyerId },
          },
        },
      }
      const payload = JSON.stringify(lifecycle)

      const response = await postSigned(payload, signStripePayload(payload))

      expect(response.status).toBe(200)
      const row = await billingEventOf(lifecycle.id)
      expect(row).toMatchObject({
        event_type: 'customer.subscription.updated',
        forward_due: false,
      })
      // The Stripe rail never writes PremiumEntitlement — state flows back
      // through the RevenueCat webhook only.
      expect(await prisma.premiumEntitlement.count({ where: { user_id: buyerId } })).toBe(
        0
      )
    })
  })
})

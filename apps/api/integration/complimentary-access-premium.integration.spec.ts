import { listenHttpApp, httpTestUrl } from '../src/testing/loopback-http-app.js'
import 'reflect-metadata'
import { randomUUID } from 'node:crypto'
import { PrismaClient } from '@prisma/client'
import { UnauthorizedException, type INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildPremiumEntitlementCreateInput,
  createPremiumEntitlement,
} from '@couture/testing'
import { isolatedCommunityDatabase } from './helpers/isolated-community-database.js'
import { RequestAuthGuard } from '../src/modules/auth/security.guards.js'
import type { AuthenticatedRequest } from '../src/modules/auth/security.types.js'
import { REVENUECAT_WEBHOOK_ROUTE } from '../src/modules/commerce/billing-webhook.controller.js'
import { buildTestOnlyRevenueCatWebhookAuth } from '../src/modules/commerce/billing-webhook.service.js'
import { BillingReconciliationService } from '../src/modules/commerce/billing-reconciliation.service.js'
import { CommerceModule } from '../src/modules/commerce/commerce.module.js'
import { PremiumEntitlementService } from '../src/modules/commerce/premium-entitlement.service.js'
import { FakeRevenueCatClient } from '../src/modules/commerce/revenuecat-client.js'
import { FakeStripeBillingClient } from '../src/modules/commerce/stripe-client.js'
import { ComplimentaryAccessService } from '../src/modules/feature-flags/complimentary-access.service.js'
import { FeatureFlagsService } from '../src/modules/feature-flags/feature-flags.service.js'
import { FeatureFlagsWarmup } from '../src/modules/feature-flags/feature-flags.warmup.js'
import { REMOTE_FEATURE_FLAG_PROVIDER } from '../src/modules/feature-flags/remote-feature-flag-provider.js'
import { TelemetryService } from '../src/modules/telemetry/telemetry.service.js'

/**
 * Story 6.14 D5 against real PostgreSQL (I-SWEEP-KEEPS, I-WEBHOOK-KEEPS, I-REFRESH-KEEPS,
 * I-REVOKE-PAID, I-REVOKE-FREE). Paid entitlement keeps one writer: the RevenueCat webhook,
 * the refresh and the reconciliation sweep move the paid row exactly as before and never
 * touch the grant row, and premium access follows the grant on top of whatever the paid
 * row says. Each test carries a non-grantee control through the same billing event.
 *
 * The database is a UUID-named copy built from the migrations and dropped afterwards. No
 * flag row is seeded and the remote provider answers undefined, so the kill switch
 * resolves to its code default, true.
 */

const database = isolatedCommunityDatabase()
const prisma = new PrismaClient({ datasources: { db: { url: database.url } } })
const remote = { getFeatureFlagValue: vi.fn(() => Promise.resolve(undefined)) }
const telemetry = { captureEvent: vi.fn() }

const SEED_OCCURRED_AT = new Date('2026-01-01T00:00:00.000Z')
const PERIOD_END = new Date('2030-01-01T00:00:00.000Z')
const T0 = new Date('2026-08-10T10:00:00.000Z').getTime()

let admin: string
let sequence = 0
const namespace = `cc614-${randomUUID().slice(0, 8)}`

async function newMember(label: string): Promise<string> {
  sequence += 1
  return (
    await prisma.user.create({
      data: { email: `${namespace}-${label}-${sequence}@synthetic.test` },
    })
  ).id
}

/** The operator service does not exist in this slice; one helper writes grant rows. */
async function grant(memberId: string): Promise<string> {
  const id = randomUUID()
  await prisma.complimentaryAccessGrant.create({
    data: {
      id,
      member_id: memberId,
      reason: 'family tester',
      granted_by_id: admin,
    },
  })
  return id
}

async function revoke(grantId: string): Promise<void> {
  await prisma.complimentaryAccessGrant.update({
    where: { id: grantId },
    data: { revoked_at: new Date(), revoked_by_id: admin, revoke_reason: 'test ended' },
  })
}

const grantRow = (id: string) =>
  prisma.complimentaryAccessGrant.findUniqueOrThrow({ where: { id } })

async function seedPaid(
  userId: string,
  status: 'active' | 'grace_period' | 'expired' | 'revoked',
  syncedAt = SEED_OCCURRED_AT
): Promise<void> {
  await prisma.premiumEntitlement.create({
    data: buildPremiumEntitlementCreateInput(
      createPremiumEntitlement({
        userId,
        status,
        store: 'app_store',
        productId: 'premium_seeded',
        willRenew: status === 'active' || status === 'grace_period',
        currentPeriodEnd: PERIOD_END,
        syncedAt,
        lastEventOccurredAt: syncedAt,
        lastEventId: `${namespace}-seed-${userId}`,
      })
    ),
  })
}

const paidRow = (userId: string) =>
  prisma.premiumEntitlement.findUnique({ where: { user_id: userId } })

const auditCount = (userId: string) =>
  prisma.auditLog.count({
    where: { user_id: userId, event_type: 'premium_entitlement_changed' },
  })

function manualEntitlements(ledger = new FakeRevenueCatClient()) {
  return new PremiumEntitlementService(
    prisma,
    ledger,
    new FakeStripeBillingClient(),
    new ComplimentaryAccessService(prisma, remote)
  )
}

beforeAll(async () => {
  await database.migrate()
  admin = await newMember('admin')
}, 120_000)

afterAll(async () => {
  await prisma.$disconnect()
  await database.drop()
})

beforeEach(() => {
  telemetry.captureEvent.mockReset().mockResolvedValue(undefined)
  remote.getFeatureFlagValue.mockClear()
})

describe('I-SWEEP-KEEPS: the reconciliation sweep never touches a grant', () => {
  it('expires a stale paid row the ledger disowns, keeps the grant byte-identical and access true', async () => {
    const stale = new Date(Date.now() - 48 * 60 * 60 * 1000)
    const grantee = await newMember('sweep-grantee')
    const control = await newMember('sweep-control')
    await seedPaid(grantee, 'active', stale)
    await seedPaid(control, 'active', stale)
    const grantId = await grant(grantee)
    const before = await grantRow(grantId)
    const ledger = new FakeRevenueCatClient()
    const entitlements = manualEntitlements(ledger)
    const sweep = new BillingReconciliationService(
      prisma,
      ledger,
      entitlements,
      telemetry as unknown as TelemetryService
    )
    const auditsBefore = await auditCount(grantee)

    const result = await sweep.sweep()

    expect(result.entitlementsCorrected).toBe(2)
    for (const userId of [grantee, control]) {
      expect(await paidRow(userId)).toMatchObject({
        status: 'expired',
        will_renew: false,
      })
    }
    expect((await auditCount(grantee)) - auditsBefore).toBe(1)
    expect(telemetry.captureEvent).toHaveBeenCalledWith(
      grantee,
      'premium_entitlement_deactivated',
      expect.objectContaining({ reason: 'expired' })
    )
    expect(await grantRow(grantId)).toEqual(before)
    expect(await entitlements.hasPremiumAccess(grantee)).toBe(true)
    expect(await entitlements.premiumAccessSource(grantee)).toBe('complimentary')
    expect(await entitlements.hasPremiumAccess(control)).toBe(false)
    expect(await entitlements.premiumAccessSource(control)).toBe('none')
  })
})

describe('I-REVOKE-PAID and I-REVOKE-FREE: revoke leaves the paid row to decide', () => {
  it('a paid active grantee revoked keeps paid access, source subscription, paid row untouched', async () => {
    const member = await newMember('revoke-paid')
    await seedPaid(member, 'active')
    const grantId = await grant(member)
    const entitlements = manualEntitlements()
    expect(await entitlements.premiumAccessSource(member)).toBe('complimentary')
    const paidBefore = await paidRow(member)

    await revoke(grantId)

    expect(await entitlements.hasPremiumAccess(member)).toBe(true)
    expect(await entitlements.premiumAccessSource(member)).toBe('subscription')
    expect(await paidRow(member)).toEqual(paidBefore)
  })

  it('a free grantee revoked loses access on the next read, source none', async () => {
    const member = await newMember('revoke-free')
    const grantId = await grant(member)
    const entitlements = manualEntitlements()
    expect(await entitlements.hasPremiumAccess(member)).toBe(true)
    expect(await entitlements.premiumAccessSource(member)).toBe('complimentary')

    await revoke(grantId)

    expect(await entitlements.hasPremiumAccess(member)).toBe(false)
    expect(await entitlements.premiumAccessSource(member)).toBe('none')
    expect(await paidRow(member)).toBeNull()
  })
})

describe('the webhook and the refresh through the real commerce module', () => {
  let app: INestApplication | undefined
  let eventSequence = 0
  const featureFlags = { getFeatureFlag: vi.fn() }

  const httpServer = () => {
    if (!app) throw new Error('App is not initialized')
    return httpTestUrl(app)
  }

  const expirationEvent = (userId: string) => {
    eventSequence += 1
    return {
      id: `${namespace}-evt-${eventSequence}`,
      type: 'EXPIRATION',
      app_user_id: userId,
      product_id: 'premium_monthly',
      expiration_at_ms: PERIOD_END.getTime(),
      event_timestamp_ms: T0 + eventSequence * 1000,
      store: 'APP_STORE',
      period_type: 'NORMAL',
      environment: 'PRODUCTION',
    }
  }

  const postEvent = (event: ReturnType<typeof expirationEvent>) =>
    request(httpServer())
      .post(REVENUECAT_WEBHOOK_ROUTE)
      .set('content-type', 'application/json')
      .set('authorization', buildTestOnlyRevenueCatWebhookAuth())
      .send(JSON.stringify({ api_version: '1.0', event }))

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({ imports: [CommerceModule] })
      .overrideProvider(PrismaClient)
      .useValue(prisma)
      .overrideProvider(REMOTE_FEATURE_FLAG_PROVIDER)
      .useValue(remote)
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
          const match = /^Bearer premium-test:(.+)$/.exec(req.headers.authorization ?? '')
          if (!match?.[1])
            throw new UnauthorizedException('Missing or invalid bearer token')
          req.auth = {
            token: req.headers.authorization!,
            userId: match[1],
            role: 'guardian',
          }
          return true
        },
      })
      .compile()
    app = moduleFixture.createNestApplication({ rawBody: true })
    await listenHttpApp(app)
  }, 60_000)

  afterAll(async () => {
    await app?.close()
  })

  beforeEach(() => {
    featureFlags.getFeatureFlag.mockReset().mockResolvedValue(false)
  })

  it('I-WEBHOOK-KEEPS: EXPIRATION expires the paid row, the grant stays and access stays', async () => {
    const grantee = await newMember('webhook-grantee')
    const control = await newMember('webhook-control')
    await seedPaid(grantee, 'active')
    await seedPaid(control, 'active')
    const grantId = await grant(grantee)
    const before = await grantRow(grantId)
    const auditsBefore = await auditCount(grantee)

    for (const userId of [grantee, control]) {
      const event = expirationEvent(userId)
      const response = await postEvent(event)
      expect(response.status, response.text).toBe(200)
      expect(response.body).toEqual({ data: { received: true } })
      expect(await paidRow(userId)).toMatchObject({
        status: 'expired',
        will_renew: false,
        product_id: 'premium_monthly',
        store: 'app_store',
        last_event_id: event.id,
      })
    }
    expect((await auditCount(grantee)) - auditsBefore).toBe(1)
    expect(await grantRow(grantId)).toEqual(before)

    const entitlements = app!.get(PremiumEntitlementService)
    expect(await entitlements.hasPremiumAccess(grantee)).toBe(true)
    expect(await entitlements.premiumAccessSource(grantee)).toBe('complimentary')
    expect(await entitlements.hasPremiumAccess(control)).toBe(false)
    expect(await entitlements.premiumAccessSource(control)).toBe('none')

    // The subscription contract keeps reporting the paid row only (D6).
    const status = await request(httpServer())
      .get('/api/v1/commerce/subscription')
      .set('authorization', `Bearer premium-test:${grantee}`)
    expect(status.status).toBe(200)
    expect((status.body as { data: { status: string } }).data.status).toBe('expired')
  })

  it('I-REFRESH-KEEPS: a refresh re-reads the ledger and leaves the grant intact', async () => {
    const grantee = await newMember('refresh-grantee')
    const control = await newMember('refresh-control')
    const grantId = await grant(grantee)
    const before = await grantRow(grantId)

    for (const userId of [grantee, control]) {
      const response = await request(httpServer())
        .post('/api/v1/commerce/subscription/refresh')
        .set('authorization', `Bearer premium-test:${userId}`)
      expect(response.status, response.text).toBe(200)
      expect((response.body as { data: { status: string } }).data.status).toBe('none')
      expect(await paidRow(userId)).toBeNull()
    }

    expect(await grantRow(grantId)).toEqual(before)
    const entitlements = app!.get(PremiumEntitlementService)
    expect(await entitlements.hasPremiumAccess(grantee)).toBe(true)
    expect(await entitlements.hasPremiumAccess(control)).toBe(false)
  })
})

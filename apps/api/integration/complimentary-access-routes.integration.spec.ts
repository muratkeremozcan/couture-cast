// Learning path Step 54: Complimentary full access.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-54-complimentary-full-access
// Story 6.14 TEA, slice 9: complimentary access over real Nest routes and real HTTP.
//
// One application compiled from the REAL Commerce, Personalization, Community and
// ShareCards modules, so the flag service, the community cache, the premium guard and
// the access route are wired as deployed. Only the edges are replaced: the database is
// an isolated one, PostHog answers false for every flag, storage is in memory, and the
// identity service maps a bearer token straight to a user id behind the real guard.
//
// Every test runs with the six member flags false globally and asserts a non-grantee
// control in the same test, so a pass proves the override and never the seed (TEA-15).
import 'reflect-metadata'
import { randomUUID, createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { PrismaClient } from '@prisma/client'
import { RequestMethod, type INestApplication } from '@nestjs/common'
import { DiscoveryModule, DiscoveryService, MetadataScanner } from '@nestjs/core'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  COMMERCE_SUBSCRIPTION_DISABLED_MESSAGE,
  COMMUNITY_FEED_DISABLED_MESSAGE,
  COMPLIMENTARY_ACCESS_ACTIVE_MESSAGE,
  PREMIUM_REQUIRED_MESSAGE,
  premiumAccessResponseSchema,
} from '@couture/api-client/contracts/http'
import {
  buildPremiumEntitlementCreateInput,
  createPremiumEntitlement,
} from '@couture/testing'
import { isolatedCommunityDatabase } from './helpers/isolated-community-database.js'
import {
  grant,
  recordingRemote,
  revoke,
  seedFlag,
  seedMemberFlagsOff,
} from './helpers/complimentary-access-fixtures.js'
import { listenHttpApp } from '../src/testing/loopback-http-app.js'
import { AccessTokenIdentityService } from '../src/modules/auth/access-token-identity.service.js'
import { GuardianConsentStateService } from '../src/modules/auth/guardian-consent-state.service.js'
import { CommerceModule } from '../src/modules/commerce/commerce.module.js'
import { StripeBillingClient } from '../src/modules/commerce/stripe-client.js'
import { CommunityModule } from '../src/modules/community/community.module.js'
import { SupabaseCommunityStorageAdapter } from '../src/modules/community/community-storage.adapter.js'
import { InMemoryCommunityStorage } from '../src/modules/community/community-storage.fake.js'
import { REMOTE_FEATURE_FLAG_PROVIDER } from '../src/modules/feature-flags/remote-feature-flag-provider.js'
import { FeatureFlagsWarmup } from '../src/modules/feature-flags/feature-flags.warmup.js'
import { PersonalizationModule } from '../src/modules/personalization/personalization.module.js'
import { ShareCardsModule } from '../src/modules/share-cards/share-cards.module.js'
import { TelemetryService } from '../src/modules/telemetry/telemetry.service.js'

const database = isolatedCommunityDatabase()
const prisma = new PrismaClient({ datasources: { db: { url: database.url } } })
/** Remote answers a test may change; unlisted flags answer false. */
const remoteAnswers: Record<string, unknown> = {}
const remote = recordingRemote(remoteAnswers)
const storage = new InMemoryCommunityStorage()
/** Whether the grant table read fails, for A-ACCESS-ERROR. */
let grantReadFails = false
const routed = new Proxy(prisma, {
  get(target, key, receiver) {
    if (key === 'complimentaryAccessGrant' && grantReadFails)
      return new Proxy(
        {},
        { get: () => () => Promise.reject(new Error('grant read failed')) }
      )
    return Reflect.get(target, key, receiver) as unknown
  },
})
const telemetry = new Proxy(
  {},
  { get: (_target, key) => (key === 'then' ? undefined : () => Promise.resolve()) }
)

let app: INestApplication
let url: string

const ACCESS = '/api/v1/commerce/premium/access'
const THEME = '/api/v1/commerce/premium/theme'
const PALETTE = '/api/v1/commerce/premium/palette'
const PLANNER = '/api/v1/commerce/premium/planner'
const FEED = '/api/v1/community/feed'
const ALLOCATE = '/api/v1/community/posts/allocate'
const PUBLISH = '/api/v1/community/posts/publish'
const CAPABILITIES = '/api/v1/share-cards/capabilities'
const CHECKOUT = '/api/v1/commerce/subscription/checkout-session'
const SUBSCRIPTION = '/api/v1/commerce/subscription'

const as = (userId: string) => ({
  authorization: `Bearer ${userId}`,
  'x-couture-platform': 'web',
})
const get = (path: string, userId: string) => request(url).get(path).set(as(userId))
const send = (method: 'post' | 'put', path: string, userId: string, body: object) =>
  request(url)[method](path).set(as(userId)).send(body)

/** An adult, active member with an email, the shape every AC1 route accepts. */
async function adult() {
  return (
    await prisma.user.create({
      data: {
        email: `canary-614-route-${randomUUID()}@example.test`,
        profile: {
          create: {
            birthdate: new Date('1990-01-01'),
            preferences: { compliance: { accountStatus: 'active' } },
          },
        },
      },
    })
  ).id
}

const allocationBody = (seed: string) => ({
  locale: 'en-US',
  contentType: 'image/jpeg',
  byteSize: 1024,
  sha256: createHash('sha256').update(seed).digest('hex'),
  widthPx: 1024,
  heightPx: 1024,
})

function allocate(userId: string) {
  return send('post', ALLOCATE, userId, allocationBody(randomUUID())).set(
    'Idempotency-Key',
    randomUUID()
  )
}

/** The status and body of every AC1 route for one member, in one comparable value. */
async function ac1(userId: string) {
  const theme = await get(THEME, userId)
  const themePut = await send('put', THEME, userId, { theme: 'jewel_radiance' })
  const palette = await get(PALETTE, userId)
  const planner = await get(PLANNER, userId)
  const feed = await get(FEED, userId)
  const allocated = await allocate(userId)
  const share = await get(CAPABILITIES, userId)
  return {
    theme: {
      status: theme.status,
      isEntitled: (theme.body as { data?: { isEntitled?: boolean } }).data?.isEntitled,
    },
    themePut: themePut.status,
    palette: {
      status: palette.status,
      isEntitled: (palette.body as { data?: { isEntitled?: boolean } }).data?.isEntitled,
      analysisEnabled: (palette.body as { data?: { analysisEnabled?: boolean } }).data
        ?.analysisEnabled,
    },
    planner: {
      status: planner.status,
      message: (planner.body as { message?: string }).message,
    },
    feed: { status: feed.status, code: (feed.body as { code?: string }).code },
    allocate: allocated.status,
    share: { status: share.status, body: share.body as unknown },
  }
}

beforeAll(async () => {
  await database.migrate()
  await seedMemberFlagsOff(prisma)
  vi.stubEnv('COMMUNITY_FLAG_FIXTURE_MODE', 'false')
  const module = await Test.createTestingModule({
    imports: [
      DiscoveryModule,
      CommerceModule,
      PersonalizationModule,
      CommunityModule,
      ShareCardsModule,
    ],
  })
    .overrideProvider(PrismaClient)
    .useValue(routed)
    .overrideProvider(REMOTE_FEATURE_FLAG_PROVIDER)
    .useValue(remote.provider)
    .overrideProvider(FeatureFlagsWarmup)
    .useValue({ onModuleInit: () => Promise.resolve() })
    .overrideProvider(TelemetryService)
    .useValue(telemetry)
    .overrideProvider(SupabaseCommunityStorageAdapter)
    .useValue(storage)
    .overrideProvider(AccessTokenIdentityService)
    .useValue({
      resolveIdentity: (token: string) =>
        Promise.resolve({ userId: token, role: 'adult' }),
    })
    .overrideProvider(GuardianConsentStateService)
    .useValue({ canTeenAccess: () => Promise.resolve(true) })
    .compile()
  app = module.createNestApplication()
  app.useLogger(false)
  url = await listenHttpApp(app)
}, 120_000)

afterEach(() => {
  grantReadFails = false
})

afterAll(async () => {
  await app?.close()
  await prisma.$disconnect()
  await database.drop()
  vi.unstubAllEnvs()
})

describe('AC1: a free grantee with every member flag off globally', () => {
  it('A-AC1-*: theme, palette, planner, feed, posting and share answer as entitled and flag-on; the control stays locked', async () => {
    const grantee = await adult()
    const control = await adult()
    await grant(prisma, grantee)

    const opened = await ac1(grantee)
    const locked = await ac1(control)

    expect(opened).toEqual({
      theme: { status: 200, isEntitled: true },
      themePut: 200,
      palette: { status: 200, isEntitled: true, analysisEnabled: true },
      // Past the premium guard and the planner flag; a member with no saved location stops here.
      planner: { status: 400, message: 'No location preferences found for user' },
      feed: { status: 200, code: undefined },
      allocate: 200,
      share: { status: 200, body: { data: { nativeShare: true } } },
    })
    expect(locked).toEqual({
      theme: { status: 200, isEntitled: false },
      themePut: 403,
      palette: { status: 200, isEntitled: false, analysisEnabled: false },
      planner: { status: 403, message: PREMIUM_REQUIRED_MESSAGE },
      feed: { status: 403, code: 'denied' },
      allocate: 503,
      share: { status: 200, body: { data: { nativeShare: false } } },
    })
  })

  it('A-AC1-POST: a grantee publishes an allocated draft; the control publish answers 503', async () => {
    const grantee = await adult()
    const control = await adult()
    await grant(prisma, grantee)

    const allocated = await allocate(grantee)
    expect(allocated.status).toBe(200)
    const draft = (
      allocated.body as { data: { postId: string; uploadSessionId: string } }
    ).data
    const row = await prisma.lookbookPost.findUniqueOrThrow({
      where: { id: draft.postId },
    })
    storage.put(row.image_object_path!, Buffer.from('uploaded'))
    const body = {
      postId: draft.postId,
      uploadSessionId: draft.uploadSessionId,
      altText: 'A person in a long coat.',
      altTextConfirmed: true,
      caption: null,
      locale: 'en-US',
    }

    const published = await send('post', PUBLISH, grantee, body).set(
      'Idempotency-Key',
      randomUUID()
    )
    expect(published.status).toBe(200)
    const after = await prisma.lookbookPost.findUniqueOrThrow({
      where: { id: draft.postId },
    })
    // Screening still runs for a grantee: the post waits for review (spec Never list).
    expect(after.status).toBe('pending_review')

    const denied = await send('post', PUBLISH, control, {
      ...body,
      postId: randomUUID(),
    }).set('Idempotency-Key', randomUUID())
    expect(denied.status).toBe(503)
    expect((denied.body as { message?: string }).message).toBe(
      COMMUNITY_FEED_DISABLED_MESSAGE
    )
  })

  it('A-REVOKE-NEXT: after a revoke every AC1 route answers exactly as the control on the next request', async () => {
    const grantee = await adult()
    const control = await adult()
    await grant(prisma, grantee)
    expect((await ac1(grantee)).feed.status).toBe(200)

    await revoke(prisma, grantee)
    expect(await ac1(grantee)).toEqual(await ac1(control))
  })
})

describe('GET /api/v1/commerce/premium/access', () => {
  async function access(userId: string) {
    const response = await get(ACCESS, userId)
    expect(response.status).toBe(200)
    return premiumAccessResponseSchema.parse(response.body).data
  }
  async function paid(userId: string) {
    await prisma.premiumEntitlement.create({
      data: buildPremiumEntitlementCreateInput(
        createPremiumEntitlement({ userId, status: 'active', willRenew: true })
      ),
    })
  }

  it('A-ACCESS-SHAPE: none, subscription, complimentary, and complimentary when both apply', async () => {
    const none = await adult()
    const subscriber = await adult()
    const grantee = await adult()
    const both = await adult()
    await paid(subscriber)
    await grant(prisma, grantee)
    await paid(both)
    await grant(prisma, both)

    expect(await access(none)).toEqual({ premium: false, source: 'none' })
    expect(await access(subscriber)).toEqual({ premium: true, source: 'subscription' })
    expect(await access(grantee)).toEqual({ premium: true, source: 'complimentary' })
    expect(await access(both)).toEqual({ premium: true, source: 'complimentary' })
  })

  it('A-ACCESS-HEADERS: Cache-Control is exactly private, no-store on 200, 401 and 500', async () => {
    const id = await adult()
    const ok = await get(ACCESS, id)
    expect(ok.status).toBe(200)
    expect(ok.headers['cache-control']).toBe('private, no-store')

    const unauthenticated = await request(url).get(ACCESS)
    expect(unauthenticated.status).toBe(401)
    expect(unauthenticated.headers['cache-control']).toBe('private, no-store')

    // A failing paid-row read is a 500; the header must survive it.
    const spy = vi
      .spyOn(prisma.premiumEntitlement, 'findUnique')
      .mockRejectedValueOnce(new Error('ledger read failed'))
    try {
      const failed = await get(ACCESS, id)
      expect(failed.status).toBe(500)
      expect(failed.headers['cache-control']).toBe('private, no-store')
    } finally {
      spy.mockRestore()
    }
  })

  it('A-ACCESS-AUTH: no bearer and a cookie-only request both answer 401', async () => {
    const id = await adult()
    expect((await request(url).get(ACCESS)).status).toBe(401)
    expect(
      (await request(url).get(ACCESS).set('Cookie', `sb-access-token=${id}`)).status
    ).toBe(401)
  })

  it('A-ACCESS-KILL: with the kill switch off a grantee reads none, a paid grantee subscription', async () => {
    const grantee = await adult()
    const paidGrantee = await adult()
    await grant(prisma, grantee)
    await paid(paidGrantee)
    await grant(prisma, paidGrantee)
    await seedFlag(prisma, 'complimentary_access_enabled', false)
    try {
      expect(await access(grantee)).toEqual({ premium: false, source: 'none' })
      expect(await access(paidGrantee)).toEqual({ premium: true, source: 'subscription' })
    } finally {
      await prisma.featureFlag.deleteMany({
        where: { key: 'complimentary_access_enabled' },
      })
    }
  })

  it('A-ACCESS-ERROR: a failing grant read answers 200 from the paid row, never 500', async () => {
    const grantee = await adult()
    const paidGrantee = await adult()
    await grant(prisma, grantee)
    await paid(paidGrantee)
    await grant(prisma, paidGrantee)
    grantReadFails = true

    expect(await access(grantee)).toEqual({ premium: false, source: 'none' })
    expect(await access(paidGrantee)).toEqual({ premium: true, source: 'subscription' })
  })
})

describe('checkout and subscription for a grantee', () => {
  it('A-CHECKOUT-409: purchasing on, a free grantee gets 409 with no Stripe call and no customer row', async () => {
    const grantee = await adult()
    const control = await adult()
    await grant(prisma, grantee)
    remoteAnswers.commerce_subscription_enabled = true
    const stripe = app.get(StripeBillingClient)
    const calls = vi.spyOn(stripe, 'createCheckoutSession')
    const customers = vi.spyOn(stripe, 'createCustomer')
    try {
      const refused = await send('post', CHECKOUT, grantee, { plan: 'premium_monthly' })
      expect(refused.status).toBe(409)
      expect((refused.body as { message?: string }).message).toBe(
        COMPLIMENTARY_ACCESS_ACTIVE_MESSAGE
      )
      expect(calls).not.toHaveBeenCalled()
      expect(customers).not.toHaveBeenCalled()
      expect(await prisma.billingCustomer.count({ where: { user_id: grantee } })).toBe(0)

      const allowed = await send('post', CHECKOUT, control, { plan: 'premium_monthly' })
      expect(allowed.status).toBe(201)
    } finally {
      calls.mockRestore()
      customers.mockRestore()
      delete remoteAnswers.commerce_subscription_enabled
    }
  })

  it('A-CHECKOUT-503: purchasing off, a grantee gets the existing 503', async () => {
    const grantee = await adult()
    await grant(prisma, grantee)
    const refused = await send('post', CHECKOUT, grantee, { plan: 'premium_monthly' })
    expect(refused.status).toBe(503)
    expect((refused.body as { message?: string }).message).toBe(
      COMMERCE_SUBSCRIPTION_DISABLED_MESSAGE
    )
  })

  it('A-SUBSCRIPTION-SAME: the subscription read for a free grantee equals a free member read', async () => {
    const grantee = await adult()
    const control = await adult()
    await grant(prisma, grantee)
    const granted = await get(SUBSCRIPTION, grantee)
    const free = await get(SUBSCRIPTION, control)
    expect(granted.status).toBe(200)
    expect(granted.body).toEqual(free.body)
    expect(JSON.stringify(granted.body)).not.toContain('complimentary')
  })

  it('premium guard message stays the shared constant for the control', async () => {
    const control = await adult()
    const response = await send('put', THEME, control, { theme: 'jewel_radiance' })
    expect(response.status).toBe(403)
    expect((response.body as { message?: string }).message).toBe(PREMIUM_REQUIRED_MESSAGE)
  })
})

describe('A-NO-GRANT-ROUTE: no HTTP path can grant or revoke', () => {
  it('no registered write route names complimentary access', () => {
    const discovery = app.get(DiscoveryService)
    const scanner = app.get(MetadataScanner)
    const writes: string[] = []
    for (const wrapper of discovery.getControllers()) {
      const instance = wrapper.instance as object | undefined
      if (!instance) continue
      if (!wrapper.metatype) continue
      const base = String(Reflect.getMetadata('path', wrapper.metatype as object) ?? '')
      for (const name of scanner.getAllMethodNames(
        Object.getPrototypeOf(instance) as object
      )) {
        const handler = (instance as Record<string, unknown>)[name]
        const method = Reflect.getMetadata('method', handler as object) as
          | RequestMethod
          | undefined
        if (method === undefined) continue
        const path = `${base}/${String(Reflect.getMetadata('path', handler as object) ?? '')}`
        if (method !== RequestMethod.GET) writes.push(path)
      }
    }
    expect(writes.length).toBeGreaterThan(0)
    expect(writes.filter((path) => /complimentary|premium\/access/i.test(path))).toEqual(
      []
    )
  })

  it('no controller file imports the operator service', () => {
    const src = resolve(__dirname, '../src')
    const offenders: string[] = []
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name)
        if (entry.isDirectory()) walk(path)
        else if (
          entry.name.endsWith('.controller.ts') &&
          /complimentary-access-operator/.test(readFileSync(path, 'utf8'))
        )
          offenders.push(path)
      }
    }
    walk(src)
    expect(offenders).toEqual([])
  })
})

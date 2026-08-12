// Learning path Step 33: Affiliate "Shop this look" CTA.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-33-affiliate-shop-this-look-cta
import 'reflect-metadata'
import { createHmac, randomUUID } from 'node:crypto'
import { PrismaClient } from '@prisma/client'
import { UnauthorizedException, type INestApplication } from '@nestjs/common'
import { Test, type TestingModule } from '@nestjs/testing'
import request from 'supertest'
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  onTestFinished,
  vi,
} from 'vitest'
import {
  COMMERCE_DISABLED_MESSAGE,
  COMMERCE_OFFER_INVALID_MESSAGE,
  COMMERCE_OFFER_NOT_FOUND_MESSAGE,
  COMMERCE_OPTED_OUT_MESSAGE,
} from '../src/contracts/http.js'
import { AffiliateClickService } from '../src/modules/commerce/affiliate-click.service.js'
import { AffiliateClickTelemetry } from '../src/modules/commerce/affiliate-click.telemetry.js'
import { TelemetryService } from '../src/modules/telemetry/telemetry.service.js'
import { CommerceModule } from '../src/modules/commerce/commerce.module.js'
import { CommerceRepository } from '../src/modules/commerce/commerce.repository.js'
import { FeatureFlagsCron } from '../src/modules/feature-flags/feature-flags.cron.js'
import { FeatureFlagsService } from '../src/modules/feature-flags/feature-flags.service.js'
import { RequestAuthGuard } from '../src/modules/auth/security.guards.js'
import type { AuthenticatedRequest } from '../src/modules/auth/security.types.js'

/**
 * Real-PostgreSQL, real-HTTP coverage for the attributed click endpoint.
 *
 * Two things here can only be proven at this level. The `201` versus `200`
 * distinction is HTTP-visible behaviour, and Story 4.4 shipped exactly that
 * distinction broken behind a unit test that spied on a mock response object, so
 * it is asserted through a Nest `TestingModule` and `supertest`. And the dedupe
 * rules are a database concern: a 60-second window read from `now()` inside the
 * statement, and a partial unique index that has to make two simultaneous
 * inserts collapse to one row.
 *
 * The real `CommerceModule` is imported rather than a hand-assembled provider
 * list, so the route path, the guard, and the `configure(...)` middleware wiring
 * are all exercised as deployed.
 *
 * NOTE: no workflow runs `test:integration`, and `apps/api/vitest.config.ts`
 * includes `integration/**` in the default `test` run, so this evidence exists
 * only where `npm run test --workspace api` is executed against a live database.
 */

const databaseUrl =
  process.env.INTEGRATION_TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgresql://postgres:postgres@127.0.0.1:54322/postgres'

/** A second client gives the concurrency test genuinely separate connections. */
const prismaA = new PrismaClient({ datasources: { db: { url: databaseUrl } } })
const prismaB = new PrismaClient({ datasources: { db: { url: databaseUrl } } })

const CLICK_TOKEN_SECRET = 'test-only-commerce-click-token-secret'
const ALLOWED_HOST = 'partner.couturecast.test'
/**
 * A file-private publication region for this suite's catalog rows, chosen so
 * they are invisible to every other integration file sharing this database. See
 * the comment on `seedOffer` for why '*' was actively harmful here. Legal under
 * the migration's check constraint, which allows '*' or `^[A-Z0-9]{2,3}$`.
 */
const CLICK_OFFER_LOCALE_REGION = 'ZZ'
const VALID_TEMPLATE = `https://${ALLOWED_HOST}/shop?cc={clickToken}`

let schemaReady = false

async function probeSchema(): Promise<void> {
  try {
    await prismaA.$queryRaw`SELECT 1 FROM "AffiliateClick" LIMIT 1`
    await prismaA.$queryRaw`SELECT 1 FROM "AffiliateOffer" LIMIT 1`
    schemaReady = true
  } catch {
    schemaReady = false
    // eslint-disable-next-line no-console
    console.warn(
      '[commerce-affiliate-clicks.integration] Skipped: PostgreSQL is missing the Story 5.1 commerce schema. ' +
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

describe('5.1 affiliate clicks against real PostgreSQL and real HTTP', () => {
  const namespace = `commerce-clicks-${randomUUID().slice(0, 8)}`
  const suiteStartedAt = new Date()

  let app: INestApplication | undefined
  let userId: string
  let partnerId: string
  let activeOfferId: string
  let recommendationId: string

  const featureFlags = { getFeatureFlag: vi.fn() }

  async function databaseNow(): Promise<Date> {
    const rows = await prismaA.$queryRaw<{ now: Date }[]>`SELECT now() AS now`
    const now = rows[0]?.now
    if (!now) {
      throw new Error('Could not read the database clock')
    }
    return now
  }

  async function seedOffer(
    id: string,
    overrides: {
      status?: 'active' | 'inactive'
      effectiveFrom?: Date
      effectiveTo?: Date | null
      deepLinkTemplate?: string
    } = {}
  ): Promise<string> {
    const offer = await prismaA.affiliateOffer.create({
      data: {
        id: `${namespace}-${id}`,
        partner_id: partnerId,
        garment_category: 'top',
        comfort_range: null,
        /*
         * A file-private region, deliberately NOT the '*' sentinel, and this is
         * load-bearing across files rather than a style choice.
         *
         * `vitest` runs integration files in parallel against one database, and
         * decision 4 makes a catalog row at '*' match EVERY request region.
         * Publishing these offers globally made them visible to
         * `commerce-affiliate-offers.integration.spec.ts`, whose whole point is
         * to assert that a query returns no offer; its `expect(match).toBeNull()`
         * cases saw these instead. That surfaced as intermittent failures in both
         * files, in opposite directions, on roughly one full-suite run in three.
         *
         * The click endpoint never filters on `locale_region`. See
         * `findActiveClickOffer`, which matches on id, offer status, partner
         * status, and window only. So a file-private region costs this suite
         * nothing and makes the interference impossible in both directions.
         */
        locale_region: CLICK_OFFER_LOCALE_REGION,
        title: `Offer ${id}`,
        deep_link_template: overrides.deepLinkTemplate ?? VALID_TEMPLATE,
        priority: 0,
        status: overrides.status ?? 'active',
        effective_from: overrides.effectiveFrom ?? new Date('2020-01-01T00:00:00.000Z'),
        effective_to: overrides.effectiveTo ?? null,
      },
    })
    return offer.id
  }

  /**
   * Registered before assertions so a failing test cannot poison a sibling.
   * Telemetry rows are cleared too: they carry `user_id: null` by design, so a
   * later "exactly one event" assertion has no way to tell an earlier test's row
   * from its own.
   */
  function cleanupClickArtifacts(): void {
    onTestFinished(async () => {
      await prismaA.affiliateClick.deleteMany({ where: { user_id: userId } })
      await prismaA.telemetryEvent.deleteMany({
        where: {
          event_type: 'affiliate_cta_clicked',
          created_at: { gte: suiteStartedAt },
        },
      })
    })
  }

  function post(body: object) {
    if (!app) {
      throw new Error('App is not initialized')
    }
    return request(app.getHttpServer() as Parameters<typeof request>[0])
      .post('/api/v1/commerce/affiliate/clicks')
      .set({ authorization: 'Bearer commerce-token' })
      .send(body)
  }

  const validBody = () => ({
    offerId: activeOfferId,
    recommendationId,
    surface: 'mobile_hero' as const,
  })

  beforeAll(async () => {
    await probeSchema()
    if (!schemaReady) {
      return
    }

    const user = await prismaA.user.create({
      data: { email: `${namespace}@synthetic.test` },
    })
    userId = user.id

    const partner = await prismaA.commercePartner.create({
      data: {
        slug: `${namespace}-partner`,
        display_name: 'Integration Partner',
        allowed_host: ALLOWED_HOST,
        status: 'active',
        webhook_secret_ref: 'COMMERCE_PARTNER_INTEGRATION_WEBHOOK_SECRET',
      },
    })
    partnerId = partner.id
    activeOfferId = await seedOffer('active')

    // The scenario is derived server-side from the recommendation, never trusted
    // from the client, so the row has to exist for the click to carry one.
    const recommendation = await prismaA.outfitRecommendation.create({
      data: { user_id: userId, scenario: 'midday' },
    })
    recommendationId = recommendation.id

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [CommerceModule],
    })
      .overrideProvider(PrismaClient)
      .useValue(prismaA)
      .overrideProvider(FeatureFlagsService)
      .useValue(featureFlags)
      // The cron's startup warmup would otherwise fire against the override and
      // log a failure on every boot of this fixture. It has nothing to do with
      // what this suite proves.
      .overrideProvider(FeatureFlagsCron)
      .useValue({ onModuleInit: () => Promise.resolve() })
      .overrideGuard(RequestAuthGuard)
      .useValue({
        canActivate: (context: {
          switchToHttp: () => { getRequest: () => AuthenticatedRequest }
        }) => {
          const req = context.switchToHttp().getRequest()
          if (req.headers.authorization !== 'Bearer commerce-token') {
            throw new UnauthorizedException('Missing or invalid bearer token')
          }
          req.auth = { token: 'commerce-token', userId, role: 'teen' }
          return true
        },
      })
      .compile()

    app = moduleFixture.createNestApplication()
    await app.init()
  })

  beforeEach(() => {
    featureFlags.getFeatureFlag.mockReset().mockResolvedValue(true)
  })

  afterAll(async () => {
    if (app) {
      await app.close()
    }
    if (schemaReady) {
      await prismaA.telemetryEvent.deleteMany({
        where: {
          event_type: 'affiliate_cta_clicked',
          created_at: { gte: suiteStartedAt },
        },
      })
      await prismaA.affiliateClick.deleteMany({ where: { user_id: userId } })
      await prismaA.affiliateOffer.deleteMany({ where: { partner_id: partnerId } })
      await prismaA.commercePreference.deleteMany({ where: { user_id: userId } })
      await prismaA.outfitRecommendation.deleteMany({ where: { user_id: userId } })
      await prismaA.commercePartner.deleteMany({ where: { id: partnerId } })
      await prismaA.user.deleteMany({ where: { id: userId } })
    }
    await prismaA.$disconnect()
    await prismaB.$disconnect()
  })

  describe('minting over real HTTP', () => {
    it('answers 201, creates exactly one row, and returns an https partner URL', async (context) => {
      if (!requireSchema(context)) return
      cleanupClickArtifacts()

      const response = await post(validBody())

      expect(response.status).toBe(201)
      const redirectUrl = (response.body as { data: { redirectUrl: string } }).data
        .redirectUrl
      const url = new URL(redirectUrl)
      expect(url.protocol).toBe('https:')
      expect(url.hostname).toBe(ALLOWED_HOST)

      const rows = await prismaA.affiliateClick.findMany({ where: { user_id: userId } })
      expect(rows).toHaveLength(1)
      const click = rows[0]
      expect(click).toBeDefined()
      // The URL carries the HMAC token, never the row id.
      expect(redirectUrl).toContain(click?.token)
      expect(redirectUrl).not.toContain(click?.id)
      expect(click?.token).toBe(
        createHmac('sha256', CLICK_TOKEN_SECRET)
          .update(click?.id ?? '')
          .digest('base64url')
      )
      expect(click?.scenario).toBe('midday')
      expect(click?.partner_id).toBe(partnerId)
    })

    it('emits exactly one pseudonymous analytics row per fresh mint', async (context) => {
      if (!requireSchema(context)) return
      cleanupClickArtifacts()

      await post(validBody())

      const events = await prismaA.telemetryEvent.findMany({
        where: {
          event_type: 'affiliate_cta_clicked',
          created_at: { gte: suiteStartedAt },
        },
      })
      expect(events).toHaveLength(1)
      expect(events[0]?.user_id).toBeNull()
      expect(JSON.stringify(events[0]?.properties)).not.toContain(userId)
    })

    it('answers 200 with the same URL on an immediate replay and creates no second row', async (context) => {
      if (!requireSchema(context)) return
      cleanupClickArtifacts()

      const first = await post(validBody())
      const second = await post(validBody())

      expect(first.status).toBe(201)
      expect(second.status).toBe(200)
      expect((second.body as { data: { redirectUrl: string } }).data.redirectUrl).toBe(
        (first.body as { data: { redirectUrl: string } }).data.redirectUrl
      )
      await expect(
        prismaA.affiliateClick.count({ where: { user_id: userId } })
      ).resolves.toBe(1)
    })
  })

  describe('the 60-second dedupe boundary', () => {
    /**
     * `created_at` is computed by the DATABASE at insert time, not from a
     * JavaScript clock read, and that is the difference between a boundary test
     * and a coin flip.
     *
     * The 59-second case has exactly one second of margin: the endpoint dedupes
     * on `created_at > now() - interval '60 seconds'`, so any wall clock that
     * elapses between fixing this timestamp and the endpoint evaluating it eats
     * directly into that second. Reading the clock in JavaScript first spent a
     * round trip on the read and another on the insert before the POST even
     * started, on a contended two-core runner that is not obviously under a
     * second, and when it is not the row ages past the window, the endpoint
     * correctly mints a fresh click, and the test fails claiming the dedupe
     * broke.
     *
     * Computing the age inside the INSERT bounds the drift to the POST's own
     * latency. `commerce-affiliate-webhook.integration.spec.ts` 5.1-INT-07 was
     * the same defect with a bigger gap: its future-tolerance case signed a
     * timestamp up front and dispatched it after eight other requests.
     */
    async function seedClickAgedBy(seconds: number): Promise<string> {
      const token = `${namespace}-preexisting-${seconds}`

      await prismaA.$executeRaw`
        INSERT INTO "AffiliateClick"
          ("id", "token", "user_id", "offer_id", "partner_id", "recommendation_id",
           "scenario", "surface", "locale_region", "created_at")
        VALUES (
          ${randomUUID()}, ${token}, ${userId}, ${activeOfferId}, ${partnerId},
          ${recommendationId}, 'midday', 'mobile_hero', '*',
          (now() AT TIME ZONE 'UTC') - (${seconds}::int * interval '1 second')
        )
      `

      return token
    }

    it('dedupes an activation at 59 seconds', async (context) => {
      if (!requireSchema(context)) return
      cleanupClickArtifacts()
      const token = await seedClickAgedBy(59)

      const response = await post(validBody())

      expect(response.status).toBe(200)
      expect(
        (response.body as { data: { redirectUrl: string } }).data.redirectUrl
      ).toContain(token)
      await expect(
        prismaA.affiliateClick.count({ where: { user_id: userId } })
      ).resolves.toBe(1)
    })

    it('mints fresh at exactly 60.000 seconds, because the window is strictly greater', async (context) => {
      if (!requireSchema(context)) return
      cleanupClickArtifacts()
      const token = await seedClickAgedBy(60)

      const response = await post(validBody())

      expect(response.status).toBe(201)
      expect(
        (response.body as { data: { redirectUrl: string } }).data.redirectUrl
      ).not.toContain(token)
      await expect(
        prismaA.affiliateClick.count({ where: { user_id: userId } })
      ).resolves.toBe(2)
    })
  })

  describe('concurrency', () => {
    it('collapses two simultaneous activations on separate connections to one row', async (context) => {
      if (!requireSchema(context)) return
      cleanupClickArtifacts()

      // Post-merge shape: AffiliateClickTelemetry now delegates to
      // TelemetryService rather than owning its own emit path, so it takes the
      // service instead of an analytics client and a Prisma client.
      const telemetry = new AffiliateClickTelemetry(
        new TelemetryService(prismaA, { capture: vi.fn() })
      )
      const build = (client: PrismaClient) =>
        new AffiliateClickService(
          featureFlags as unknown as FeatureFlagsService,
          new CommerceRepository(client),
          telemetry
        )

      // Both services skip the read-then-write dedupe check at the same instant,
      // so the partial unique index on the minute bucket is the only thing
      // standing between this and two rows. The loser re-reads the winner.
      const [resultA, resultB] = await Promise.all([
        build(prismaA).recordClick({ ...validBody(), userId }),
        build(prismaB).recordClick({ ...validBody(), userId }),
      ])

      await expect(
        prismaA.affiliateClick.count({ where: { user_id: userId } })
      ).resolves.toBe(1)
      expect(resultA.redirectUrl).toBe(resultB.redirectUrl)
      // Exactly one of them minted; the other deduped onto the winner.
      expect([resultA.created, resultB.created].filter(Boolean)).toHaveLength(1)
    })
  })

  describe('status precedence over real HTTP', () => {
    it('answers 503 while the kill switch is off, ahead of every other check', async (context) => {
      if (!requireSchema(context)) return
      cleanupClickArtifacts()
      featureFlags.getFeatureFlag.mockResolvedValue(false)

      const response = await post({ ...validBody(), offerId: 'does-not-exist' })

      expect(response.status).toBe(503)
      expect(response.body).toMatchObject({ message: COMMERCE_DISABLED_MESSAGE })
      await expect(
        prismaA.affiliateClick.count({ where: { user_id: userId } })
      ).resolves.toBe(0)
    })

    it('answers 403 for an opted-out user, ahead of an unknown offer', async (context) => {
      if (!requireSchema(context)) return
      cleanupClickArtifacts()
      await prismaA.commercePreference.create({
        data: { user_id: userId, affiliate_ctas_enabled: false },
      })
      onTestFinished(async () => {
        await prismaA.commercePreference.deleteMany({ where: { user_id: userId } })
      })

      const response = await post({ ...validBody(), offerId: 'does-not-exist' })

      expect(response.status).toBe(403)
      expect(response.body).toMatchObject({ message: COMMERCE_OPTED_OUT_MESSAGE })
    })

    /**
     * A plain loop rather than `it.each`: Vitest appends the test context as a
     * trailing argument for `each` cases but does not type it, and these tests
     * need `context.skip()` to skip cleanly against an unmigrated database.
     */
    const notFoundCases: { name: string; seed: () => Promise<string> }[] = [
      {
        name: 'an offer that does not exist',
        seed: () => Promise.resolve('missing-offer'),
      },
      {
        name: 'an inactive offer',
        seed: () => seedOffer('inactive', { status: 'inactive' }),
      },
      {
        name: 'an offer whose window has not opened',
        seed: async () =>
          seedOffer('future', {
            effectiveFrom: new Date((await databaseNow()).getTime() + 60_000),
          }),
      },
      {
        name: 'an offer whose window has closed',
        seed: async () => seedOffer('expired', { effectiveTo: await databaseNow() }),
      },
    ]

    for (const { name, seed } of notFoundCases) {
      it(`answers 404 for ${name} and creates no row`, async (context) => {
        if (!requireSchema(context)) return
        cleanupClickArtifacts()
        const offerId = await seed()

        const response = await post({ ...validBody(), offerId })

        expect(response.status).toBe(404)
        expect(response.body).toMatchObject({ message: COMMERCE_OFFER_NOT_FOUND_MESSAGE })
        await expect(
          prismaA.affiliateClick.count({ where: { user_id: userId } })
        ).resolves.toBe(0)
      })
    }

    const invalidTemplateCases: { name: string; template: string }[] = [
      { name: 'no {clickToken} placeholder', template: `https://${ALLOWED_HOST}/shop` },
      { name: 'plain http', template: `http://${ALLOWED_HOST}/shop?cc={clickToken}` },
      {
        name: 'a userinfo component',
        template: `https://a:b@${ALLOWED_HOST}/?cc={clickToken}`,
      },
      {
        name: 'a host outside allowed_host',
        template: 'https://evil.test/?cc={clickToken}',
      },
      { name: 'an unparseable template', template: 'shop?cc={clickToken}' },
    ]

    for (const { name, template } of invalidTemplateCases) {
      it(`answers 500 for a template with ${name} and creates no row`, async (context) => {
        if (!requireSchema(context)) return
        cleanupClickArtifacts()
        const offerId = await seedOffer(`bad-${name.replaceAll(/\W+/g, '-')}`, {
          deepLinkTemplate: template,
        })

        const response = await post({ ...validBody(), offerId })

        expect(response.status).toBe(500)
        expect(response.body).toMatchObject({ message: COMMERCE_OFFER_INVALID_MESSAGE })
        await expect(
          prismaA.affiliateClick.count({ where: { user_id: userId } })
        ).resolves.toBe(0)
      })
    }

    it('answers 400 for a body the contract rejects', async (context) => {
      if (!requireSchema(context)) return

      const response = await post({ offerId: activeOfferId, surface: 'mobile_hero' })

      expect(response.status).toBe(400)
    })

    it('answers 401 with no bearer token', async (context) => {
      if (!requireSchema(context) || !app) return

      const response = await request(app.getHttpServer() as Parameters<typeof request>[0])
        .post('/api/v1/commerce/affiliate/clicks')
        .send(validBody())

      expect(response.status).toBe(401)
    })
  })

  describe('cache headers, applied by CommerceModule.configure', () => {
    const cacheHeaderCases: {
      name: string
      flagEnabled: boolean
      expectedStatus: number
    }[] = [
      { name: 'a successful mint', flagEnabled: true, expectedStatus: 201 },
      {
        name: 'a 503 raised before the handler returns',
        flagEnabled: false,
        expectedStatus: 503,
      },
    ]

    for (const { name, flagEnabled, expectedStatus } of cacheHeaderCases) {
      it(`sets private, no-store on ${name}`, async (context) => {
        if (!requireSchema(context)) return
        cleanupClickArtifacts()
        featureFlags.getFeatureFlag.mockResolvedValue(flagEnabled)

        const response = await post(validBody())

        expect(response.status).toBe(expectedStatus)
        expect(response.headers['cache-control']).toBe('private, no-store')
      })
    }
  })
})

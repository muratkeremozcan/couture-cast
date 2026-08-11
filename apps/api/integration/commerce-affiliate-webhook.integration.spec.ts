import 'reflect-metadata'
import { randomUUID } from 'node:crypto'
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
import type { TestingModule } from '@nestjs/testing'
import { Test } from '@nestjs/testing'
import type { INestApplication } from '@nestjs/common'
import { HttpAdapterHost } from '@nestjs/core'
import { PrismaClient } from '@prisma/client'
import request from 'supertest'
import {
  affiliateWebhookResponseSchema,
  badRequestHttpErrorSchema,
  unauthorizedHttpErrorSchema,
  WEBHOOK_SIGNATURE_INVALID_MESSAGE,
} from '@couture/api-client/contracts/http'
import {
  createAffiliateClick,
  createCommercePartner,
  persistAffiliateClick,
  persistCommerceCatalog,
} from '@couture/testing'
import {
  ANALYTICS_CLIENT,
  type AnalyticsClient,
} from '../src/analytics/analytics.service'
import { ApiExceptionFilter } from '../src/filters/api-exception.filter'
import { FeatureFlagsService } from '../src/modules/feature-flags/feature-flags.service'
import {
  AFFILIATE_WEBHOOK_ROUTE,
  AffiliateWebhookController,
} from '../src/modules/commerce/affiliate-webhook.controller'
import { AffiliateWebhookService } from '../src/modules/commerce/affiliate-webhook.service'
import {
  resolvePartnerWebhookSecret,
  signAffiliateWebhookPayload,
  WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS,
} from '../src/modules/commerce/affiliate-webhook-signature'
import { TelemetryService } from '../src/modules/telemetry/telemetry.service'

/**
 * Story 5.1 Task 5, real PostgreSQL and real HTTP.
 *
 * Everything here goes over the wire through `supertest` against a Nest
 * `TestingModule`, for the Story 4.4 reason: that story shipped a 201-versus-200
 * fix whose tests spied on a hand-built mock response and stayed green when the
 * controller was reverted. A status matrix asserted anywhere other than over HTTP
 * proves nothing about the endpoint.
 *
 * The application is created with `rawBody: true`, matching `src/main.ts` and
 * `api/index.ts`. Without it the reordered-keys proof below would exercise a
 * `rawBody === undefined` path and pass for entirely the wrong reason.
 *
 * NOTE ON CI. No workflow runs `test:integration`, so this evidence is
 * local-only and unprotected after merge. Every branch asserted here also has
 * unit coverage in `affiliate-webhook.service.spec.ts` for that reason.
 */

const databaseUrl =
  process.env.INTEGRATION_TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgresql://postgres:postgres@127.0.0.1:54322/postgres'

const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } })

const NAMESPACE = `webhook-it-${randomUUID().slice(0, 8)}`

let schemaReady = false

async function probeSchema(): Promise<void> {
  try {
    await prisma.$queryRaw`SELECT 1 FROM "CommercePartner" LIMIT 1`
    await prisma.$queryRaw`SELECT 1 FROM "AffiliateConversion" LIMIT 1`
    schemaReady = true
  } catch {
    schemaReady = false
    // eslint-disable-next-line no-console
    console.warn(
      '[commerce-affiliate-webhook.integration] Skipped: PostgreSQL is missing the Story 5.1 commerce schema.'
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

type SignedRequest = {
  headers: Record<string, string>
  body: string
}

const VALID_PAYLOAD = {
  eventId: 'placeholder',
  clickToken: 'placeholder',
  occurredAt: '2026-08-11T10:00:00.000Z',
  status: 'confirmed' as const,
  orderValueMinorUnits: 12_900,
  currency: 'USD',
}

describe('Story 5.1 affiliate conversion webhook against real PostgreSQL', () => {
  let app: INestApplication | undefined
  let capturedEvents: { distinctId: string; event: string; properties: unknown }[] = []

  const httpServer = (): Parameters<typeof request>[0] => {
    if (!app) {
      throw new Error('App is not initialized')
    }
    return app.getHttpServer() as Parameters<typeof request>[0]
  }

  /**
   * Persists a namespaced partner and an offer, registering cleanup with
   * `onTestFinished` BEFORE the caller asserts anything, so a genuine failure
   * here cannot manufacture a second failure in a sibling test.
   */
  async function createPartner(
    overrides: { status?: 'active' | 'inactive' } = {}
  ): Promise<{ id: string; slug: string; secretRef: string; secret: string }> {
    const slug = `${NAMESPACE}-${randomUUID().slice(0, 6)}`
    const { partner } = await persistCommerceCatalog(prisma, {
      partner: createCommercePartner({ slug, status: overrides.status ?? 'active' }),
    })

    onTestFinished(async () => {
      await prisma.affiliateConversion.deleteMany({ where: { partner_id: partner.id } })
      await prisma.affiliateClick.deleteMany({ where: { partner_id: partner.id } })
      await prisma.affiliateOffer.deleteMany({ where: { partner_id: partner.id } })
      await prisma.commercePartner.deleteMany({ where: { id: partner.id } })
      await prisma.telemetryEvent.deleteMany({
        where: {
          event_type: 'affiliate_conversion_recorded',
          properties: { path: ['partner_id'], equals: partner.slug },
        },
      })
    })

    const secret = resolvePartnerWebhookSecret(partner.webhook_secret_ref)
    if (secret === null) {
      throw new Error(
        `Fixture partner ${partner.slug} produced no signing secret; the test-only fallback is not reachable here.`
      )
    }

    return {
      id: partner.id,
      slug: partner.slug,
      secretRef: partner.webhook_secret_ref,
      secret,
    }
  }

  /** Creates a real user, offer, and click so a conversion can match something. */
  async function createMatchableClick(partnerId: string): Promise<{
    token: string
    userId: string
    clickId: string
  }> {
    const user = await prisma.user.create({
      data: { email: `${NAMESPACE}-${randomUUID().slice(0, 8)}@synthetic.test` },
    })
    const offer = await prisma.affiliateOffer.findFirstOrThrow({
      where: { partner_id: partnerId },
    })

    onTestFinished(async () => {
      // Clicks cascade from the user; the explicit delete keeps the order
      // deterministic when the conversion cleanup above has already run.
      await prisma.user.deleteMany({ where: { id: user.id } })
    })

    const click = await persistAffiliateClick(
      prisma,
      createAffiliateClick({
        token: `click-token-${randomUUID()}`,
        userId: user.id,
        offerId: offer.id,
        partnerId,
      })
    )

    return { token: click.token, userId: user.id, clickId: click.id }
  }

  function sign(
    secret: string,
    partnerSlug: string,
    // A string is passed verbatim, which is how the reordered-keys proof controls
    // the exact bytes; anything else is serialized here.
    body: unknown,
    options: { timestampSeconds?: number } = {}
  ): SignedRequest {
    const serialized = typeof body === 'string' ? body : JSON.stringify(body)
    const rawBody = Buffer.from(serialized, 'utf8')
    const timestamp = String(options.timestampSeconds ?? Math.floor(Date.now() / 1000))

    return {
      body: serialized,
      headers: {
        'content-type': 'application/json',
        'x-couture-partner-id': partnerSlug,
        'x-couture-timestamp': timestamp,
        'x-couture-signature': signAffiliateWebhookPayload(timestamp, rawBody, secret),
      },
    }
  }

  function post(signed: SignedRequest) {
    // No Authorization header anywhere in this suite. The route carries no
    // `@UseGuards` and this app registers no APP_GUARD, so a future global guard
    // would turn every one of these into a 401 and be caught here.
    return request(httpServer())
      .post(AFFILIATE_WEBHOOK_ROUTE)
      .set(signed.headers)
      .send(signed.body)
  }

  beforeAll(async () => {
    await probeSchema()
    if (!schemaReady) return

    const analyticsClient: AnalyticsClient = {
      capture: vi.fn(
        (event: { distinctId: string; event: string; properties: unknown }) =>
          void capturedEvents.push(event)
      ),
    } as unknown as AnalyticsClient

    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [AffiliateWebhookController],
      providers: [
        AffiliateWebhookService,
        TelemetryService,
        { provide: PrismaClient, useValue: prisma },
        { provide: ANALYTICS_CLIENT, useValue: analyticsClient },
      ],
    }).compile()

    app = moduleFixture.createNestApplication({ rawBody: true })
    // `src/main.ts` installs this filter globally, so the exclusion under test
    // has to be exercised through the same wiring the deployed app uses.
    app.useGlobalFilters(
      new ApiExceptionFilter(app.get(HttpAdapterHost), app.get(TelemetryService))
    )
    await app.init()
  })

  beforeEach(() => {
    capturedEvents = []
  })

  afterAll(async () => {
    if (app) {
      await app.close()
      app = undefined
    }
    await prisma.$disconnect()
  })

  describe('reachability and the happy path', () => {
    it('5.1-INT-01 records a matched conversion over HTTP with no Authorization header', async (context) => {
      if (!requireSchema(context)) return

      const partner = await createPartner()
      const click = await createMatchableClick(partner.id)
      const eventId = `evt-${randomUUID()}`

      const response = await post(
        sign(partner.secret, partner.slug, {
          ...VALID_PAYLOAD,
          eventId,
          clickToken: click.token,
        })
      )

      expect(response.status).toBe(200)
      expect(affiliateWebhookResponseSchema.parse(response.body)).toEqual({
        data: { received: true },
      })

      const stored = await prisma.affiliateConversion.findUniqueOrThrow({
        where: {
          partner_id_external_event_id: {
            partner_id: partner.id,
            external_event_id: eventId,
          },
        },
      })
      expect(stored.affiliate_click_id).toBe(click.clickId)
      expect(stored.status).toBe('confirmed')
      expect(stored.order_value_minor_units).toBe(12_900)
      expect(stored.currency).toBe('USD')
      expect(stored.occurred_at.toISOString()).toBe('2026-08-11T10:00:00.000Z')

      const emitted = capturedEvents.filter(
        (event) => event.event === 'affiliate_conversion_recorded'
      )
      expect(emitted).toHaveLength(1)
      expect(emitted[0]?.properties).toEqual({
        partner_id: partner.slug,
        status: 'confirmed',
        currency: 'USD',
        order_value_minor_units: 12_900,
        matched: true,
        $ip: null,
      })
      // The subject is the HMAC pseudonym, never the click owner's raw id.
      expect(emitted[0]?.distinctId).not.toBe(click.userId)
      expect(emitted[0]?.distinctId).not.toBe(partner.slug)
    })

    it('5.1-INT-02 records an unknown click token unattributed and emits matched false', async (context) => {
      if (!requireSchema(context)) return

      const partner = await createPartner()
      const eventId = `evt-${randomUUID()}`

      const response = await post(
        sign(partner.secret, partner.slug, {
          ...VALID_PAYLOAD,
          eventId,
          clickToken: `never-issued-${randomUUID()}`,
        })
      )

      expect(response.status).toBe(200)
      const stored = await prisma.affiliateConversion.findUniqueOrThrow({
        where: {
          partner_id_external_event_id: {
            partner_id: partner.id,
            external_event_id: eventId,
          },
        },
      })
      expect(stored.affiliate_click_id).toBeNull()

      const emitted = capturedEvents.filter(
        (event) => event.event === 'affiliate_conversion_recorded'
      )
      expect(emitted).toHaveLength(1)
      expect(emitted[0]?.distinctId).toBe(partner.slug)
      expect(emitted[0]?.properties).toMatchObject({ matched: false })
    })

    it('5.1-INT-03 records a conversion signed with an operator-configured secret', async (context) => {
      if (!requireSchema(context)) return

      const partner = await createPartner()
      const configured = 'an-operator-configured-secret-of-at-least-32-chars'
      vi.stubEnv(partner.secretRef, configured)
      onTestFinished(() => {
        vi.unstubAllEnvs()
      })
      const eventId = `evt-${randomUUID()}`

      const response = await post(
        sign(configured, partner.slug, {
          ...VALID_PAYLOAD,
          eventId,
          clickToken: 'unmatched',
        })
      )

      expect(response.status).toBe(200)
      // The test-only fallback must be inert once a real value is configured.
      const rejected = await post(
        sign(partner.secret, partner.slug, {
          ...VALID_PAYLOAD,
          eventId: `evt-${randomUUID()}`,
          clickToken: 'unmatched',
        })
      )
      expect(rejected.status).toBe(401)
    })
  })

  describe('idempotency', () => {
    it('5.1-INT-04 answers a replayed event id with 200, writing nothing and emitting nothing', async (context) => {
      if (!requireSchema(context)) return

      const partner = await createPartner()
      const click = await createMatchableClick(partner.id)
      const eventId = `evt-${randomUUID()}`
      const payload = { ...VALID_PAYLOAD, eventId, clickToken: click.token }

      const first = await post(sign(partner.secret, partner.slug, payload))
      expect(first.status).toBe(200)
      capturedEvents = []

      // A fresh timestamp and signature: a replay is the same event id, not the
      // same bytes, and a partner retrying an hour later re-signs.
      const second = await post(sign(partner.secret, partner.slug, payload))

      expect(second.status).toBe(200)
      expect(affiliateWebhookResponseSchema.parse(second.body)).toEqual({
        data: { received: true },
      })
      const rows = await prisma.affiliateConversion.findMany({
        where: { partner_id: partner.id, external_event_id: eventId },
      })
      expect(rows).toHaveLength(1)
      expect(capturedEvents).toHaveLength(0)
    })

    it('5.1-INT-05 keeps one row per event id when two deliveries race on separate connections', async (context) => {
      if (!requireSchema(context)) return

      const partner = await createPartner()
      const eventId = `evt-${randomUUID()}`
      const payload = { ...VALID_PAYLOAD, eventId, clickToken: 'unmatched' }

      const [first, second] = await Promise.all([
        post(sign(partner.secret, partner.slug, payload)),
        post(sign(partner.secret, partner.slug, payload)),
      ])

      expect(first.status).toBe(200)
      expect(second.status).toBe(200)
      const rows = await prisma.affiliateConversion.findMany({
        where: { partner_id: partner.id, external_event_id: eventId },
      })
      expect(rows).toHaveLength(1)
      // Exactly one of the two deliveries persisted, so exactly one emitted.
      expect(
        capturedEvents.filter((e) => e.event === 'affiliate_conversion_recorded')
      ).toHaveLength(1)
    })

    it('5.1-INT-06 keeps the same event id distinct across two partners', async (context) => {
      if (!requireSchema(context)) return

      // Idempotency is keyed on (partner, event id). Two partners numbering their
      // events from one must not collide.
      const partnerA = await createPartner()
      const partnerB = await createPartner()
      const eventId = 'evt-1'
      const payload = { ...VALID_PAYLOAD, eventId, clickToken: 'unmatched' }

      expect((await post(sign(partnerA.secret, partnerA.slug, payload))).status).toBe(200)
      expect((await post(sign(partnerB.secret, partnerB.slug, payload))).status).toBe(200)

      const rows = await prisma.affiliateConversion.findMany({
        where: {
          external_event_id: eventId,
          partner_id: { in: [partnerA.id, partnerB.id] },
        },
      })
      expect(rows).toHaveLength(2)
    })
  })

  describe('the signature matrix', () => {
    it('5.1-INT-07 rejects every signature failure with the identical 401 and no rows', async (context) => {
      if (!requireSchema(context)) return

      const partner = await createPartner()
      const eventId = `evt-${randomUUID()}`
      const payload = { ...VALID_PAYLOAD, eventId, clickToken: 'unmatched' }
      const valid = sign(partner.secret, partner.slug, payload)
      const nowSeconds = Math.floor(Date.now() / 1000)
      const inactivePartner = await createPartner({ status: 'inactive' })

      const cases: { name: string; signed: SignedRequest }[] = [
        {
          name: 'a missing partner header',
          signed: withoutHeader(valid, 'x-couture-partner-id'),
        },
        {
          name: 'a missing timestamp header',
          signed: withoutHeader(valid, 'x-couture-timestamp'),
        },
        {
          name: 'a missing signature header',
          signed: withoutHeader(valid, 'x-couture-signature'),
        },
        {
          name: 'a non-integer timestamp',
          signed: withHeader(valid, 'x-couture-timestamp', '1760000000.5'),
        },
        {
          name: 'a negative timestamp',
          signed: withHeader(valid, 'x-couture-timestamp', '-1760000000'),
        },
        {
          name: 'an uppercase hex signature',
          signed: withHeader(
            valid,
            'x-couture-signature',
            (valid.headers['x-couture-signature'] ?? '').toUpperCase()
          ),
        },
        {
          name: 'a truncated signature',
          signed: withHeader(valid, 'x-couture-signature', 'deadbeef'),
        },
        {
          name: 'an unknown partner slug',
          signed: withHeader(valid, 'x-couture-partner-id', `${NAMESPACE}-nobody`),
        },
        {
          name: 'an inactive partner',
          signed: sign(inactivePartner.secret, inactivePartner.slug, payload),
        },
        {
          name: 'a timestamp one second beyond the past tolerance',
          signed: sign(partner.secret, partner.slug, payload, {
            timestampSeconds: nowSeconds - (WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS + 1),
          }),
        },
        {
          name: 'a timestamp one second beyond the future tolerance',
          signed: sign(partner.secret, partner.slug, payload, {
            timestampSeconds: nowSeconds + WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS + 1,
          }),
        },
        {
          name: 'a signature over different bytes',
          signed: {
            ...valid,
            headers: {
              ...valid.headers,
              'x-couture-signature': signAffiliateWebhookPayload(
                valid.headers['x-couture-timestamp'] ?? '0',
                Buffer.from('{"eventId":"someone-else"}', 'utf8'),
                partner.secret
              ),
            },
          },
        },
        {
          name: 'a signature made with the wrong secret',
          signed: sign(
            'a-secret-that-belongs-to-nobody-and-is-32-plus-chars',
            partner.slug,
            payload
          ),
        },
      ]

      for (const { name, signed } of cases) {
        const response = await post(signed)

        expect(response.status, name).toBe(401)
        // One message for every failure mode, so the endpoint cannot be used to
        // learn which partners exist or which secrets are configured.
        expect(unauthorizedHttpErrorSchema.parse(response.body).message, name).toBe(
          WEBHOOK_SIGNATURE_INVALID_MESSAGE
        )
      }

      expect(
        await prisma.affiliateConversion.count({
          where: { partner_id: { in: [partner.id, inactivePartner.id] } },
        })
      ).toBe(0)
      expect(capturedEvents).toHaveLength(0)
    })

    async function expectTimestampAccepted(offset: number): Promise<void> {
      const partner = await createPartner()
      const eventId = `evt-${randomUUID()}`

      const response = await post(
        sign(
          partner.secret,
          partner.slug,
          { ...VALID_PAYLOAD, eventId, clickToken: 'unmatched' },
          { timestampSeconds: Math.floor(Date.now() / 1000) + offset }
        )
      )

      expect(response.status).toBe(200)
      expect(
        await prisma.affiliateConversion.count({
          where: { partner_id: partner.id, external_event_id: eventId },
        })
      ).toBe(1)
    }

    it('5.1-INT-08 accepts a timestamp exactly at the tolerance in the past', async (context) => {
      if (!requireSchema(context)) return

      await expectTimestampAccepted(-WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS)
    })

    it('5.1-INT-08b accepts a timestamp exactly at the tolerance in the future', async (context) => {
      if (!requireSchema(context)) return

      await expectTimestampAccepted(WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS)
    })

    it('5.1-INT-09 rejects a partner whose configured secret is under the length floor', async (context) => {
      if (!requireSchema(context)) return

      const partner = await createPartner()
      vi.stubEnv(partner.secretRef, 'too-short')
      onTestFinished(() => {
        vi.unstubAllEnvs()
      })

      const response = await post(
        sign('too-short', partner.slug, {
          ...VALID_PAYLOAD,
          eventId: `evt-${randomUUID()}`,
          clickToken: 'unmatched',
        })
      )

      expect(response.status).toBe(401)
      expect(response.body).toMatchObject({
        message: WEBHOOK_SIGNATURE_INVALID_MESSAGE,
      })
    })
  })

  describe('raw body fidelity', () => {
    it('5.1-INT-10 verifies a body whose key order and whitespace differ from a re-serialization', async (context) => {
      if (!requireSchema(context)) return

      const partner = await createPartner()
      const eventId = `evt-${randomUUID()}`
      // Deliberately hostile serialization: reversed key order, newlines, and
      // indentation. `JSON.stringify(JSON.parse(body))` produces different bytes,
      // so this only passes if the signature covers what actually arrived.
      const body = [
        '{',
        '  "currency": "USD",',
        '  "orderValueMinorUnits": 12900,',
        '  "status": "confirmed",',
        '  "occurredAt": "2026-08-11T10:00:00.000Z",',
        '  "clickToken": "unmatched",',
        `  "eventId": "${eventId}"`,
        '}',
      ].join('\n')

      expect(JSON.stringify(JSON.parse(body) as unknown)).not.toBe(body)

      const response = await post(sign(partner.secret, partner.slug, body))

      expect(response.status).toBe(200)
      expect(
        await prisma.affiliateConversion.count({
          where: { partner_id: partner.id, external_event_id: eventId },
        })
      ).toBe(1)
    })

    it('5.1-INT-11 returns 400 for a signed body that fails the payload schema', async (context) => {
      if (!requireSchema(context)) return

      const partner = await createPartner()

      const response = await post(
        sign(partner.secret, partner.slug, {
          ...VALID_PAYLOAD,
          eventId: `evt-${randomUUID()}`,
          clickToken: 'unmatched',
          status: 'refunded',
        })
      )

      expect(response.status).toBe(400)
      badRequestHttpErrorSchema.parse(response.body)
      expect(
        await prisma.affiliateConversion.count({ where: { partner_id: partner.id } })
      ).toBe(0)
    })

    it('5.1-INT-11b answers unparseable JSON with 400 at the transport layer, before any signature check', async (context) => {
      if (!requireSchema(context)) return

      // A DOCUMENTED DEVIATION from the five-step order, pinned here so it is
      // visible rather than discovered.
      //
      // Nest installs its JSON body parser ahead of the router, so a body that is
      // not valid JSON is rejected with 400 before this controller is reached,
      // even when the signature is garbage. The order the story specifies would
      // return 401 there. Closing the gap means bypassing the global parser for
      // this one route in all three bootstraps, and `api/index.ts` installs no
      // middleware at all, so the cost is high and the exposure is nil: the
      // response reveals nothing about which partners exist or which secrets are
      // configured, which is the property the uniform 401 protects. The
      // amplification guard still holds, asserted below.
      const partner = await createPartner()
      const since = new Date(Date.now() - 1000)

      const response = await request(httpServer())
        .post(AFFILIATE_WEBHOOK_ROUTE)
        .set('content-type', 'application/json')
        .set('x-couture-partner-id', partner.slug)
        .set('x-couture-timestamp', String(Math.floor(Date.now() / 1000)))
        .set('x-couture-signature', 'f'.repeat(64))
        .send('{"eventId": ')

      expect(response.status).toBe(400)
      badRequestHttpErrorSchema.parse(response.body)
      expect(
        await prisma.affiliateConversion.count({ where: { partner_id: partner.id } })
      ).toBe(0)

      // The route exclusion is matched on the path, and the parser error carries
      // the same path, so this cannot be used to amplify telemetry writes either.
      const errorRows = await prisma.telemetryEvent.findMany({
        where: { event_type: 'api_error_occurred', created_at: { gte: since } },
      })
      expect(
        errorRows.filter(
          (row) =>
            (row.properties as { route?: string } | null)?.route ===
            AFFILIATE_WEBHOOK_ROUTE
        )
      ).toHaveLength(0)
    })
  })

  describe('degradation and amplification', () => {
    it('5.1-INT-12 records conversions without ever consulting commerce_affiliate_enabled', async (context) => {
      if (!requireSchema(context)) return

      // The kill switch gates the CTA and the click endpoint only. Returning 503
      // to a retrying partner is exactly the retry storm the flag exists to
      // avoid, and it would discard facts about purchases that already happened.
      //
      // Asserted as "the flag is never read" rather than by flipping the shared
      // `FeatureFlag` row to false. Four sessions share this database and the
      // seeded row is what makes the feature reachable for Playwright and
      // Maestro; a test that toggles it can break a sibling suite mid-run. The
      // spy is also the stronger assertion: it fails the moment someone adds a
      // flag check here, whatever value the row happens to hold.
      const flagSpy = vi.spyOn(FeatureFlagsService.prototype, 'getFeatureFlag')
      onTestFinished(() => {
        flagSpy.mockRestore()
      })

      const partner = await createPartner()
      const eventId = `evt-${randomUUID()}`

      const response = await post(
        sign(partner.secret, partner.slug, {
          ...VALID_PAYLOAD,
          eventId,
          clickToken: 'unmatched',
        })
      )

      expect(response.status).toBe(200)
      expect(
        await prisma.affiliateConversion.count({
          where: { partner_id: partner.id, external_event_id: eventId },
        })
      ).toBe(1)
      expect(flagSpy).not.toHaveBeenCalled()
    })

    it('5.1-INT-13 writes no api_error_occurred telemetry row for a rejected webhook', async (context) => {
      if (!requireSchema(context)) return

      // An unauthenticated endpoint that persists a row per rejected request is a
      // free amplification vector against a table pruned only hourly.
      const partner = await createPartner()
      const since = new Date(Date.now() - 1000)

      const response = await post(
        withHeader(
          sign(partner.secret, partner.slug, {
            ...VALID_PAYLOAD,
            eventId: `evt-${randomUUID()}`,
            clickToken: 'unmatched',
          }),
          'x-couture-signature',
          'f'.repeat(64)
        )
      )
      expect(response.status).toBe(401)

      const errorRows = await prisma.telemetryEvent.findMany({
        where: { event_type: 'api_error_occurred', created_at: { gte: since } },
      })
      const webhookRows = errorRows.filter(
        (row) =>
          (row.properties as { route?: string } | null)?.route === AFFILIATE_WEBHOOK_ROUTE
      )
      expect(webhookRows).toHaveLength(0)
      expect(capturedEvents.filter((e) => e.event === 'api_error_occurred')).toHaveLength(
        0
      )
    })
  })

  describe('retention', () => {
    it('5.1-INT-14 leaves aged commerce records untouched when the telemetry pruner runs', async (context) => {
      if (!requireSchema(context)) return

      // AffiliateClick and AffiliateConversion sit beside TelemetryEvent and the
      // hourly pruner is one generalized `where` clause from deleting commercial
      // records. Their own retention is 24 months, enforced separately.
      const partner = await createPartner()
      const click = await createMatchableClick(partner.id)
      const aged = new Date(Date.now() - 72 * 60 * 60 * 1000)

      await prisma.affiliateClick.update({
        where: { id: click.clickId },
        data: { created_at: aged },
      })
      const conversion = await prisma.affiliateConversion.create({
        data: {
          partner_id: partner.id,
          external_event_id: `evt-${randomUUID()}`,
          affiliate_click_id: click.clickId,
          status: 'confirmed',
          order_value_minor_units: 1000,
          currency: 'USD',
          occurred_at: aged,
          received_at: aged,
        },
      })
      const agedTelemetry = await prisma.telemetryEvent.create({
        data: {
          event_type: 'forecast_viewed',
          properties: { namespace: NAMESPACE },
          created_at: aged,
        },
      })

      // Only rows older than 24 hours are removed, which no concurrent suite can
      // be relying on: every test in this repo creates its telemetry rows now.
      await app?.get(TelemetryService).pruneOldTelemetryEvents()

      expect(await prisma.affiliateClick.count({ where: { id: click.clickId } })).toBe(1)
      expect(
        await prisma.affiliateConversion.count({ where: { id: conversion.id } })
      ).toBe(1)
      expect(await prisma.telemetryEvent.count({ where: { id: agedTelemetry.id } })).toBe(
        0
      )
    })
  })
})

function withoutHeader(signed: SignedRequest, header: string): SignedRequest {
  const headers = { ...signed.headers }
  delete headers[header]
  return { ...signed, headers }
}

function withHeader(signed: SignedRequest, header: string, value: string): SignedRequest {
  return { ...signed, headers: { ...signed.headers, [header]: value } }
}

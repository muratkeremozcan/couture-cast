import 'reflect-metadata'
import { randomUUID } from 'node:crypto'
import { PrismaClient } from '@prisma/client'
import { UnauthorizedException, type INestApplication } from '@nestjs/common'
import { Test, type TestingModule } from '@nestjs/testing'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildPremiumEntitlementCreateInput,
  createPremiumEntitlement,
} from '@couture/testing'
import { RequestAuthGuard } from '../src/modules/auth/security.guards.js'
import type { AuthenticatedRequest } from '../src/modules/auth/security.types.js'
import { CommerceModule } from '../src/modules/commerce/commerce.module.js'
import { FeatureFlagsCron } from '../src/modules/feature-flags/feature-flags.cron.js'
import { FeatureFlagsService } from '../src/modules/feature-flags/feature-flags.service.js'
import { TelemetryService } from '../src/modules/telemetry/telemetry.service.js'

/**
 * Story 5.3 follow-up: closes `deferred-work.md`'s "5.3-INT-001 and
 * 5.3-INT-002 have no test" entry. The story's coverage matrix names
 * `5.3-INT-001` (persist, reload, same theme, over HTTP) as P0 evidence for AC
 * 3 and `5.3-INT-002` (a web-selected palette visible on a mobile GET) as P1.
 * Both were integration tier, which was out of scope for the unit-only pass
 * the story narrowed to; what existed was `premium-theme.service.spec.ts`'s
 * in-memory-Map double, which can prove Decision 8's never-delete rule at the
 * mock layer but not that a row actually survives a reconnect to real
 * PostgreSQL, nor that the real `user_id` unique index and `@updatedAt`
 * column behave as the service assumes.
 *
 * TWO INDEPENDENT APP/CONNECTION CONTEXTS, NOT ONE. `app` and `app2` are two
 * separately compiled `TestingModule`s, each with its own `PrismaClient`
 * (its own connection to the same real Postgres). This is what "drop the app,
 * or open a fresh one" and "a fresh, independent request/app-context" mean in
 * practice: a value written through `app` and read back through `app2` cannot
 * be explained by any in-process cache, because the two share no JS heap
 * state, only the database. `PremiumThemeService` holds no cache today, so
 * this is what actually proves that rather than assumes it.
 *
 * 5.3-INT-002 IS A SERVER-SIDE-CONSISTENCY PROOF, NOT MOBILE-CLIENT WIRING.
 * There is no mobile client in the API tier to drive — Task 6 (the entire
 * mobile surface) was cancelled for this pass (`deferred-work.md`, "story 5.3
 * ... entire mobile surface"). What this proves is the thing a mobile GET
 * would actually depend on: a palette written by one request/app-context is
 * visible, correctly, to a different request/app-context reading the same
 * `userId`. That is necessary but not sufficient evidence for cross-device
 * propagation; say so here rather than implying more than is shown.
 *
 * FLAG AND TELEMETRY ARE MOCKED, ENTITLEMENT IS REAL. `FeatureFlagsService`
 * is overridden the same way every sibling `premium-*.integration.spec.ts`
 * overrides it (`premium_themes_enabled` defaults to `false` in the registry,
 * Decision 9 of the story doc), so this suite does not depend on the DB seed
 * having run. `TelemetryService` is overridden the same way
 * `premium-stripe-rail.integration.spec.ts` overrides it: `emitSelection` is
 * fail-open and not what this suite is proving, and stubbing it means no
 * `TelemetryEvent` cleanup is needed. `PremiumEntitlement`, by contrast, is a
 * REAL row inserted directly via Prisma (same technique
 * `premium-subscription.integration.spec.ts`'s `seedEntitlement` uses),
 * because `PremiumEntitlementGuard` is what actually gates the PUT route and
 * a mocked guard would prove nothing about the real wiring.
 *
 * NOTE: no workflow runs `test:integration` in CI (deferred-work #10); this
 * evidence exists where `npm run test:integration --workspace api` runs
 * against a live database.
 */

const databaseUrl =
  process.env.INTEGRATION_TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgresql://postgres:postgres@127.0.0.1:54322/postgres'

const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } })

let schemaReady = false

async function probeSchema(): Promise<void> {
  try {
    await prisma.$queryRaw`SELECT 1 FROM "PremiumThemePreference" LIMIT 1`
    await prisma.$queryRaw`SELECT 1 FROM "PremiumEntitlement" LIMIT 1`
    schemaReady = true
  } catch {
    schemaReady = false
    // eslint-disable-next-line no-console
    console.warn(
      '[premium-theme.integration] Skipped: PostgreSQL is missing the Story 5.3 theme schema. ' +
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

const ROUTE = '/api/v1/commerce/premium/theme'

type ThemeEnvelope = {
  data: { theme: string | null; isEntitled: boolean; themesEnabled: boolean }
  message?: string
}

function envelope(response: { body: unknown }): ThemeEnvelope {
  return response.body as ThemeEnvelope
}

/** Small, real delay so two writes cannot land in the same DB millisecond. */
function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

describe('5.3 premium theme preference against real PostgreSQL and real HTTP', () => {
  // File-private namespace: keeps this run's synthetic user distinguishable
  // from any other suite sharing the same database (development-guide.md's
  // "two apps/api integration runs against one PostgreSQL collide" note).
  const namespace = `premium-theme-${randomUUID().slice(0, 8)}`

  let app: INestApplication | undefined
  let app2: INestApplication | undefined
  let prisma2: PrismaClient | undefined
  let userId: string

  const featureFlags = { getFeatureFlag: vi.fn() }
  const telemetry = { captureEvent: vi.fn() }

  const tokenFor = (id: string) => `Bearer premium-test:${id}`

  function guardOverride() {
    return {
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
    }
  }

  /**
   * Builds one fully independent Nest application over the REAL
   * `CommerceModule`, wired to the given Prisma client. Called twice in
   * `beforeAll` so `app` and `app2` share no in-process state at all.
   */
  async function buildApp(prismaClient: PrismaClient): Promise<INestApplication> {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [CommerceModule],
    })
      .overrideProvider(PrismaClient)
      .useValue(prismaClient)
      .overrideProvider(FeatureFlagsService)
      .useValue(featureFlags)
      .overrideProvider(FeatureFlagsCron)
      .useValue({ onModuleInit: () => Promise.resolve() })
      .overrideProvider(TelemetryService)
      .useValue(telemetry)
      .overrideGuard(RequestAuthGuard)
      .useValue(guardOverride())
      .compile()

    const nestApp = moduleFixture.createNestApplication()
    await nestApp.init()
    return nestApp
  }

  function httpServerOf(instance: INestApplication | undefined) {
    if (!instance) {
      throw new Error('App is not initialized')
    }
    return instance.getHttpServer() as Parameters<typeof request>[0]
  }

  function getTheme(instance: INestApplication | undefined, id: string) {
    return request(httpServerOf(instance))
      .get(ROUTE)
      .set({ authorization: tokenFor(id) })
  }

  function putTheme(
    instance: INestApplication | undefined,
    id: string,
    body: Record<string, unknown>
  ) {
    return request(httpServerOf(instance))
      .put(ROUTE)
      .set({ authorization: tokenFor(id) })
      .send(body)
  }

  async function seedEntitlement(id: string): Promise<void> {
    const data = buildPremiumEntitlementCreateInput(
      createPremiumEntitlement({
        userId: id,
        status: 'active',
        willRenew: true,
        lastEventId: `${namespace}-seed`,
      })
    )
    await prisma.premiumEntitlement.create({ data })
  }

  beforeAll(async () => {
    await probeSchema()
    if (!schemaReady) return

    const user = await prisma.user.create({
      data: { email: `${namespace}@synthetic.test` },
    })
    userId = user.id
    await seedEntitlement(userId)

    app = await buildApp(prisma)

    // A second, independently created Prisma client -- its own connection to
    // the same real database -- backing a second, independently compiled Nest
    // app. See the docblock: this is what "drop the app / open a fresh one"
    // proves in a suite that also needs `app` alive for other tests.
    prisma2 = new PrismaClient({ datasources: { db: { url: databaseUrl } } })
    app2 = await buildApp(prisma2)
  })

  beforeEach(async () => {
    featureFlags.getFeatureFlag.mockReset().mockResolvedValue(true)
    telemetry.captureEvent.mockReset().mockResolvedValue(undefined)
    if (schemaReady) {
      // Clean slate per test: the row is user-scoped and unique on user_id,
      // so a prior test's write would otherwise leak into the next test's
      // first GET.
      await prisma.premiumThemePreference.deleteMany({ where: { user_id: userId } })
    }
  })

  afterAll(async () => {
    if (app) {
      await app.close()
    }
    if (app2) {
      await app2.close()
    }
    if (schemaReady) {
      await prisma.premiumThemePreference.deleteMany({ where: { user_id: userId } })
      await prisma.premiumEntitlement.deleteMany({ where: { user_id: userId } })
      // Unlike premium-subscription.integration.spec.ts's users, this suite's
      // user is safe to delete: no service path exercised here writes an
      // AuditLog row (theme changes are explicitly not audited, per
      // premium-theme.service.ts's docblock), so nothing RESTRICTs the delete.
      await prisma.user.deleteMany({ where: { id: userId } })
    }
    await prisma.$disconnect()
    await prisma2?.$disconnect()
  })

  it('5.3-INT-001 persists a PUT across a fresh app/connection and re-GET returns the same theme (P0, AC 3)', async (context) => {
    if (!requireSchema(context)) return

    const putResponse = await putTheme(app, userId, { theme: 'jewel_radiance' })
    expect(putResponse.status).toBe(200)
    expect(envelope(putResponse).data).toMatchObject({
      theme: 'jewel_radiance',
      isEntitled: true,
      themesEnabled: true,
    })

    // Re-GET through app2: a separately compiled Nest app over a separate
    // Prisma connection that has never seen this process's write except
    // through the database. Proves persistence survives a real reconnect,
    // not an in-memory store the unit tier's Map double stands in for.
    const getResponse = await getTheme(app2, userId)
    expect(getResponse.status).toBe(200)
    expect(envelope(getResponse).data).toMatchObject({
      theme: 'jewel_radiance',
      isEntitled: true,
      themesEnabled: true,
    })

    const row = await prisma.premiumThemePreference.findUniqueOrThrow({
      where: { user_id: userId },
    })
    expect(row.theme).toBe('jewel_radiance')
  })

  it('5.3-INT-002 a palette written by one request is read correctly by a different, independent request for the same user (P1)', async (context) => {
    if (!requireSchema(context)) return

    // Simulates "web wrote it, mobile reads it": there is no separate mobile
    // client in the API tier (Task 6 cancelled), so the proof is a PUT
    // through one app/connection context followed by a GET through a
    // different, independent one, for the same userId. This shows
    // server-side consistency of the stored preference, not actual
    // mobile-client wiring, which does not exist yet.
    const putResponse = await putTheme(app, userId, { theme: 'autumn_umber' })
    expect(putResponse.status).toBe(200)

    const getResponse = await getTheme(app2, userId)
    expect(getResponse.status).toBe(200)
    expect(envelope(getResponse).data.theme).toBe('autumn_umber')
  })

  it('reset semantics (Decision 8): PUT { theme: null } leaves exactly one row with theme = null, never a delete', async (context) => {
    if (!requireSchema(context)) return

    const initial = await putTheme(app, userId, { theme: 'winter_metallic' })
    expect(initial.status).toBe(200)

    let rows = await prisma.premiumThemePreference.findMany({
      where: { user_id: userId },
    })
    expect(rows).toHaveLength(1)
    expect(rows[0]?.theme).toBe('winter_metallic')

    const reset = await putTheme(app, userId, { theme: null })
    expect(reset.status).toBe(200)
    expect(envelope(reset).data).toMatchObject({
      theme: null,
      isEntitled: true,
      themesEnabled: true,
    })

    // The row count assertion is the point: a delete-on-reset implementation
    // would pass a naive "GET resolves to Default" check but leave zero rows
    // here instead of one.
    rows = await prisma.premiumThemePreference.findMany({ where: { user_id: userId } })
    expect(rows).toHaveLength(1)
    expect(rows[0]?.theme).toBeNull()

    // A subsequent GET, through the independent app2, also resolves Default.
    const getResponse = await getTheme(app2, userId)
    expect(envelope(getResponse).data.theme).toBeNull()
  })

  it('updated_at moves between an initial PUT and a second PUT with a different value', async (context) => {
    if (!requireSchema(context)) return

    const first = await putTheme(app, userId, { theme: 'jewel_radiance' })
    expect(first.status).toBe(200)
    const rowAfterFirst = await prisma.premiumThemePreference.findUniqueOrThrow({
      where: { user_id: userId },
    })

    await wait(15)

    const second = await putTheme(app, userId, { theme: 'autumn_umber' })
    expect(second.status).toBe(200)
    const rowAfterSecond = await prisma.premiumThemePreference.findUniqueOrThrow({
      where: { user_id: userId },
    })

    expect(rowAfterSecond.updated_at.getTime()).toBeGreaterThan(
      rowAfterFirst.updated_at.getTime()
    )
  })

  it('updated_at also moves on a PUT that resubmits the already-stored value (documents the real Prisma upsert behavior)', async (context) => {
    if (!requireSchema(context)) return

    const first = await putTheme(app, userId, { theme: 'jewel_radiance' })
    expect(first.status).toBe(200)
    const rowAfterFirst = await prisma.premiumThemePreference.findUniqueOrThrow({
      where: { user_id: userId },
    })

    await wait(15)

    // Same value resubmitted. premium-theme.service.ts's setTheme always
    // calls upsert's `update: { theme }` branch (there is no early-return
    // "value unchanged" short-circuit at the service/repository level -- that
    // guard lives client-side only, per 5.3-WEB-115 in the story doc's review
    // findings). Prisma's @updatedAt stamps on every executed UPDATE, whether
    // or not the other column values actually changed, so this row's
    // updated_at moves too. Asserted directly against real Postgres rather
    // than assumed, per this follow-up's brief.
    const second = await putTheme(app, userId, { theme: 'jewel_radiance' })
    expect(second.status).toBe(200)
    const rowAfterSecond = await prisma.premiumThemePreference.findUniqueOrThrow({
      where: { user_id: userId },
    })

    expect(rowAfterSecond.theme).toBe('jewel_radiance')
    expect(rowAfterSecond.updated_at.getTime()).toBeGreaterThan(
      rowAfterFirst.updated_at.getTime()
    )
  })
})

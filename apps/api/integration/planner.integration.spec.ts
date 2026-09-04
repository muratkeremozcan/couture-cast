// Story 5.5 Task 10: the premium 7-day outfit planner against real PostgreSQL
// and real HTTP.
import 'reflect-metadata'
import { randomUUID } from 'node:crypto'
import { PrismaClient } from '@prisma/client'
import { UnauthorizedException, type INestApplication } from '@nestjs/common'
import { Test, type TestingModule } from '@nestjs/testing'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  buildPremiumEntitlementCreateInput,
  buildPlannerDayPlanCreateInput,
  createPremiumEntitlement,
  createPlannerDayPlan,
  createSavedLocation,
  createUser,
  createWardrobeItem,
} from '@couture/testing'
import { RequestAuthGuard } from '../src/modules/auth/security.guards.js'
import type { AuthenticatedRequest } from '../src/modules/auth/security.types.js'
import { PersonalizationModule } from '../src/modules/personalization/personalization.module.js'
import {
  resolvePlannerDateWindow,
  resolveRitualAnchorDate,
  toDatabaseDate,
} from '../src/modules/personalization/ritual-generation.engine.js'
import { plannerPersistedPayloadSchema } from '../src/modules/personalization/planner-payload.schema.js'
import { FeatureFlagsWarmup } from '../src/modules/feature-flags/feature-flags.warmup.js'
import { FeatureFlagsService } from '../src/modules/feature-flags/feature-flags.service.js'
import { TelemetryService } from '../src/modules/telemetry/telemetry.service.js'
import { SupabaseWardrobeStorageAdapter } from '../src/modules/wardrobe/wardrobe-storage.adapter.js'
import { PLANNER_DAY_CHANGED_MESSAGE } from '../src/contracts/http.js'

/**
 * Story 5.5 Task 10: the planner SERVICE layer against a real database and a
 * real Nest HTTP stack.
 *
 * `packages/db/test/planner-schema.spec.ts` already pins the schema (unique
 * key, composite FK, cascades, grants/policies) by inserting rows with raw
 * SQL, and `packages/db/test/rls/planner.spec.ts` already pins the owner-only
 * actor matrix. Neither exercises `PlannerService` itself. What can only be
 * proven here, against real Postgres and real generated data:
 *
 * - a stored row actually regenerates when its dependency fingerprint moves,
 *   and actually regenerates when it stays put but the payload can no longer
 *   be trusted (fails the internal strict schema, or names a garment that is
 *   no longer eligible) -- Decision 4/9;
 * - pruning a stale row and cascading away a deleted location's rows are real
 *   DELETE statements a mocked Prisma cannot demonstrate;
 * - two concurrent cold reads racing the same unique key produce exactly one
 *   persisted winner that both callers observe -- the P2002-catch-and-recover
 *   path in `persistGeneratedDay`, which a mock cannot exercise because there
 *   is no real unique constraint to violate;
 * - a stale reshuffle `expectedVersion` returns the real `409` and leaves the
 *   real row's `version`/`plan_payload` untouched.
 *
 * `planner.service.spec.ts` (mocked Prisma) already covers gate ordering,
 * flag-off, partial-day isolation, and the same properties above at the
 * mocked layer; this file's job is proving they hold against a real database.
 *
 * FLAG AND TELEMETRY ARE MOCKED, ENTITLEMENT IS REAL, STORAGE IS A DOUBLE --
 * the same split every sibling `premium-*.integration.spec.ts` and
 * `palette-advisor.integration.spec.ts` use. `premium_planner_enabled`
 * defaults to `false` in the registry, so the flag is stubbed rather than
 * depending on the DB seed; `PremiumEntitlement` is a real row because
 * `PremiumEntitlementGuard` is what actually gates both planner routes; and
 * `SupabaseWardrobeStorageAdapter` is a double because Supabase Storage is
 * not part of what this suite proves and cannot be stood up locally. Weather
 * is left genuinely absent (no `WeatherSnapshot` row) rather than mocked: the
 * engine's own `unavailable` branch produces a deterministic wardrobe
 * baseline from real garments, which is enough to exercise every persistence
 * property below without needing a weather fixture.
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
    await prisma.$queryRaw`SELECT 1 FROM "PlannerDayPlan" LIMIT 1`
    await prisma.$queryRaw`SELECT 1 FROM "SavedLocation" LIMIT 1`
    await prisma.$queryRaw`SELECT 1 FROM "PremiumEntitlement" LIMIT 1`
    schemaReady = true
  } catch (error) {
    schemaReady = false
    // eslint-disable-next-line no-console
    console.warn(
      '[planner.integration] Skipped: could not query the Story 5.5 planner schema. ' +
        'If the schema is missing, run `npm run db:migrate`. Underlying error:',
      error
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

const ROUTE = '/api/v1/commerce/premium/planner'

/** `resolveRitualAnchorDate` returns ritual's `MM/DD/YYYY` cache-key format;
 * the test needs the same `YYYY-MM-DD` window PlannerService computes, so
 * this converts once, exactly like `PlannerService`'s own private
 * `toIsoDate` does. */
function toIsoDate(mmddyyyy: string): string {
  const [month, day, year] = mmddyyyy.split('/')
  return `${year}-${month}-${day}`
}

function computeAnchorDate(timezone: string): string {
  return toIsoDate(resolveRitualAnchorDate(new Date(), timezone))
}

function shiftIsoDate(isoDate: string, offsetDays: number): string {
  const [year, month, day] = isoDate.split('-').map(Number) as [number, number, number]
  const shifted = new Date(Date.UTC(year, month - 1, day + offsetDays))
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}-${String(
    shifted.getUTCDate()
  ).padStart(2, '0')}`
}

type PlannerHttpDay = {
  status: 'ready' | 'error'
  planDate: string
  version?: number
  outfits?: {
    scenario: string
    garmentIds: string[]
    capsuleId: string | null
    reasoningBadges: unknown[]
    comfortNotes: string
    displayGarments: { id: string; category: string | null }[]
  }[]
}

type PlannerHttpResponse = {
  data: {
    locationId: string
    anchorDate: string
    daysReady: number
    days: PlannerHttpDay[]
  }
}

/** Strips the per-request signed-URL expiry so two concurrent responses
 * built from the SAME persisted row compare equal: `imageAccess.expiresAt`
 * is computed fresh on every request (Decision 4) and therefore legitimately
 * differs between two callers even when every other field is identical. */
function stripVolatile(day: PlannerHttpDay): unknown {
  if (day.status !== 'ready') return day
  return {
    ...day,
    outfits: day.outfits?.map((outfit) => ({
      ...outfit,
      displayGarments: outfit.displayGarments.map((garment) => ({
        id: garment.id,
        category: garment.category,
      })),
    })),
  }
}

describe('5.5 premium planner against real PostgreSQL and real HTTP', () => {
  // File-private namespace: keeps this run's synthetic users distinguishable
  // from any other suite sharing the same database.
  const namespace = `planner-it-${randomUUID().slice(0, 8)}`

  let app: INestApplication | undefined

  const featureFlags = { getFeatureFlag: vi.fn() }
  const telemetry = { captureEvent: vi.fn() }
  const storage = {
    signReadUrl: vi.fn().mockResolvedValue('https://storage.test/signed'),
    upload: vi.fn().mockResolvedValue(undefined),
    download: vi.fn().mockResolvedValue(Buffer.from([])),
    remove: vi.fn().mockResolvedValue(undefined),
  }

  const tokenFor = (id: string) => `Bearer planner-test:${id}`

  function guardOverride() {
    return {
      canActivate: (context: {
        switchToHttp: () => { getRequest: () => AuthenticatedRequest }
      }) => {
        const req = context.switchToHttp().getRequest()
        const header = req.headers.authorization ?? ''
        const match = /^Bearer planner-test:(.+)$/.exec(header)
        if (!match || !match[1]) {
          throw new UnauthorizedException('Missing or invalid bearer token')
        }
        req.auth = { token: header, userId: match[1], role: 'guardian' }
        return true
      },
    }
  }

  function httpServer() {
    if (!app) {
      throw new Error('App is not initialized')
    }
    return app.getHttpServer() as Parameters<typeof request>[0]
  }

  function getPlanner(
    userId: string,
    locationId: string,
    platform: 'web' | 'mobile' = 'web'
  ) {
    return request(httpServer())
      .get(ROUTE)
      .query({ locationId })
      .set({ authorization: tokenFor(userId), 'x-couture-platform': platform })
  }

  function reshuffleDay(
    userId: string,
    planDate: string,
    locationId: string,
    body: { expectedVersion: number },
    platform: 'web' | 'mobile' = 'web'
  ) {
    return request(httpServer())
      .post(`${ROUTE}/${planDate}/reshuffle`)
      .query({ locationId })
      .set({ authorization: tokenFor(userId), 'x-couture-platform': platform })
      .send(body)
  }

  /**
   * Creates a fresh, entitled user with a primary UTC-timezone saved
   * location and a small real, eligible wardrobe (top/bottom/shoes, plus a
   * second `cool`-range top so a comfort-preference change has a concrete,
   * different garment to select). A fresh user per test mirrors every
   * sibling `premium-*.integration.spec.ts`: the planner window covers seven
   * dates sharing one unique key per (user, location, date), so reusing a
   * user across tests would make one test's persisted rows visible to the
   * next.
   */
  async function arrangeUser(
    label: string,
    overrides: { runsColdWarm?: 'cold' | 'warm' | 'neutral' } = {}
  ) {
    const email = `${namespace}-${label}-${randomUUID().slice(0, 8)}@synthetic.test`
    const user = await createUser(
      {
        email,
        comfortPreferences: overrides.runsColdWarm
          ? { runsColdWarm: overrides.runsColdWarm }
          : undefined,
      },
      { persist: true, prisma }
    )
    const userId = user.id

    await prisma.premiumEntitlement.create({
      data: buildPremiumEntitlementCreateInput(
        createPremiumEntitlement({
          userId,
          status: 'active',
          willRenew: true,
          lastEventId: `${namespace}-${userId}-seed`,
        })
      ),
    })

    const location = await createSavedLocation(
      { userId, timezone: 'UTC', isPrimary: true },
      { persist: true, prisma }
    )

    const topMild = await createWardrobeItem(
      { userId, category: 'top', comfortRange: 'mild' },
      { persist: true, prisma }
    )
    const topCool = await createWardrobeItem(
      { userId, category: 'top', comfortRange: 'cool' },
      { persist: true, prisma }
    )
    const bottom = await createWardrobeItem(
      { userId, category: 'bottom', comfortRange: 'mild' },
      { persist: true, prisma }
    )
    const shoes = await createWardrobeItem(
      { userId, category: 'shoes', comfortRange: 'mild' },
      { persist: true, prisma }
    )

    return {
      userId,
      locationId: location.id,
      garments: { topMild, topCool, bottom, shoes },
    }
  }

  async function findRow(userId: string, locationId: string, planDate: string) {
    return prisma.plannerDayPlan.findUniqueOrThrow({
      where: {
        user_id_location_id_plan_date: {
          user_id: userId,
          location_id: locationId,
          plan_date: toDatabaseDate(planDate),
        },
      },
    })
  }

  beforeAll(async () => {
    await probeSchema()
    if (!schemaReady) return

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [PersonalizationModule],
    })
      .overrideProvider(PrismaClient)
      .useValue(prisma)
      .overrideProvider(FeatureFlagsService)
      .useValue(featureFlags)
      .overrideProvider(FeatureFlagsWarmup)
      .useValue({ onModuleInit: () => Promise.resolve() })
      .overrideProvider(TelemetryService)
      .useValue(telemetry)
      .overrideProvider(SupabaseWardrobeStorageAdapter)
      .useValue(storage)
      .overrideGuard(RequestAuthGuard)
      .useValue(guardOverride())
      .compile()

    app = moduleFixture.createNestApplication()
    await app.init()

    featureFlags.getFeatureFlag.mockResolvedValue(true)
    telemetry.captureEvent.mockResolvedValue(undefined)
  })

  afterAll(async () => {
    if (app) {
      await app.close()
    }
    if (schemaReady) {
      // Reverse dependency order: planner rows before locations/garments,
      // then entitlement/comfort/profile, then the users themselves.
      await prisma.plannerDayPlan.deleteMany({
        where: { user: { email: { startsWith: namespace } } },
      })
      await prisma.savedLocation.deleteMany({
        where: { user: { email: { startsWith: namespace } } },
      })
      await prisma.garmentItem.deleteMany({
        where: { user: { email: { startsWith: namespace } } },
      })
      await prisma.premiumEntitlement.deleteMany({
        where: { user: { email: { startsWith: namespace } } },
      })
      await prisma.comfortPreferences.deleteMany({
        where: { user: { email: { startsWith: namespace } } },
      })
      await prisma.userProfile.deleteMany({
        where: { user: { email: { startsWith: namespace } } },
      })
      await prisma.user.deleteMany({ where: { email: { startsWith: namespace } } })
    }
    await prisma.$disconnect()
  })

  it('5.5-INT-01 regenerates a persisted day when its dependency fingerprint changes (comfort preference)', async (context) => {
    if (!requireSchema(context)) return

    const { userId, locationId, garments } = await arrangeUser('invalidate')
    const anchorDate = computeAnchorDate('UTC')
    const targetDate = resolvePlannerDateWindow(anchorDate)[0]

    const first = await getPlanner(userId, locationId)
    expect(first.status).toBe(200)
    const firstBody = first.body as PlannerHttpResponse
    expect(firstBody.data.days.find((d) => d.planDate === targetDate)?.status).toBe(
      'ready'
    )

    const firstRow = await findRow(userId, locationId, targetDate)
    const firstPayload = plannerPersistedPayloadSchema.parse(firstRow.plan_payload)
    // Neutral (default) preference resolves the exact `mild` top, not the
    // `cool` alternative.
    expect(
      firstPayload.outfits.some((o) => o.garmentIds.includes(garments.topCool.id))
    ).toBe(false)

    // Touch exactly one fingerprint input (Decision 2/9): comfort preference.
    await prisma.comfortPreferences.update({
      where: { user_id: userId },
      data: { runs_cold_warm: 'cold' },
    })

    const second = await getPlanner(userId, locationId)
    expect(second.status).toBe(200)
    const secondBody = second.body as PlannerHttpResponse
    expect(secondBody.data.days.find((d) => d.planDate === targetDate)?.status).toBe(
      'ready'
    )

    const secondRow = await findRow(userId, locationId, targetDate)
    expect(secondRow.id).toBe(firstRow.id) // update-by-id, not delete-then-create
    expect(secondRow.dependency_fingerprint).not.toBe(firstRow.dependency_fingerprint)

    const secondPayload = plannerPersistedPayloadSchema.parse(secondRow.plan_payload)
    expect(secondPayload).not.toEqual(firstPayload)
    // Concrete, not just hash-different: a `cold` preference resolves the
    // `cool`-range top instead of the `mild` one.
    expect(
      secondPayload.outfits.some((o) => o.garmentIds.includes(garments.topCool.id))
    ).toBe(true)
  })

  it('5.5-INT-02 prunes the acting user rows dated before the current anchor on the next read', async (context) => {
    if (!requireSchema(context)) return

    const { userId, locationId } = await arrangeUser('prune')
    const anchorDate = computeAnchorDate('UTC')
    const staleDate = shiftIsoDate(anchorDate, -5)

    const stale = createPlannerDayPlan({
      userId,
      locationId,
      planDate: toDatabaseDate(staleDate),
      dependencyFingerprint: `${namespace}-stale`,
    })
    await prisma.plannerDayPlan.create({ data: buildPlannerDayPlanCreateInput(stale) })

    expect(
      await prisma.plannerDayPlan.findUnique({ where: { id: stale.id } })
    ).not.toBeNull()

    const response = await getPlanner(userId, locationId)
    expect(response.status).toBe(200)

    expect(await prisma.plannerDayPlan.findUnique({ where: { id: stale.id } })).toBeNull()
  })

  it('5.5-INT-03 lets exactly one row win a concurrent cold-read race and both callers return it', async (context) => {
    if (!requireSchema(context)) return

    const { userId, locationId } = await arrangeUser('race')
    const anchorDate = computeAnchorDate('UTC')
    const window = resolvePlannerDateWindow(anchorDate)

    // Neither caller has an existing row for any date in the window: both
    // pipelines generate independently and race the same unique key on every
    // date's INSERT (Decision 4/AC 9).
    const [respA, respB] = await Promise.all([
      getPlanner(userId, locationId),
      getPlanner(userId, locationId),
    ])

    expect(respA.status).toBe(200)
    expect(respB.status).toBe(200)
    const bodyA = respA.body as PlannerHttpResponse
    const bodyB = respB.body as PlannerHttpResponse

    for (const planDate of window) {
      const dayA = bodyA.data.days.find((d) => d.planDate === planDate)
      const dayB = bodyB.data.days.find((d) => d.planDate === planDate)
      expect(dayA?.status, planDate).toBe('ready')
      expect(dayB?.status, planDate).toBe('ready')
      // Both callers built their response from the SAME winning row -- the
      // loser's `create()` hits P2002 and rereads the winner rather than
      // returning its own locally generated (and never persisted) content.
      expect(stripVolatile(dayA!), planDate).toEqual(stripVolatile(dayB!))

      const rows = await prisma.plannerDayPlan.findMany({
        where: {
          user_id: userId,
          location_id: locationId,
          plan_date: toDatabaseDate(planDate),
        },
      })
      expect(rows, planDate).toHaveLength(1)
      expect(rows[0]?.version, planDate).toBe(1)
    }
  })

  it('5.5-INT-04 cascades a real generated day away when its saved location is deleted', async (context) => {
    if (!requireSchema(context)) return

    const { userId, locationId } = await arrangeUser('cascade')

    const response = await getPlanner(userId, locationId)
    expect(response.status).toBe(200)
    expect((response.body as PlannerHttpResponse).data.daysReady).toBeGreaterThan(0)

    const before = await prisma.plannerDayPlan.count({
      where: { user_id: userId, location_id: locationId },
    })
    expect(before).toBeGreaterThan(0)

    await prisma.savedLocation.delete({ where: { id: locationId } })

    const after = await prisma.plannerDayPlan.count({
      where: { user_id: userId, location_id: locationId },
    })
    expect(after).toBe(0)
  })

  it('5.5-INT-05 discards a row that fails the persisted-payload schema and regenerates it in place', async (context) => {
    if (!requireSchema(context)) return

    const { userId, locationId } = await arrangeUser('malformed-schema')
    const anchorDate = computeAnchorDate('UTC')
    const targetDate = resolvePlannerDateWindow(anchorDate)[2]

    const malformed = createPlannerDayPlan({
      userId,
      locationId,
      planDate: toDatabaseDate(targetDate),
      dependencyFingerprint: `${namespace}-garbage`,
      planPayload: { not: 'a valid plan' },
    })
    await prisma.plannerDayPlan.create({
      data: buildPlannerDayPlanCreateInput(malformed),
    })

    const response = await getPlanner(userId, locationId)
    expect(response.status).toBe(200)
    const day = (response.body as PlannerHttpResponse).data.days.find(
      (d) => d.planDate === targetDate
    )
    expect(day?.status).toBe('ready')
    expect(day?.outfits).toHaveLength(3)

    const row = await prisma.plannerDayPlan.findUniqueOrThrow({
      where: { id: malformed.id },
    })
    expect(row.id).toBe(malformed.id) // update-by-id: same row, new payload
    expect(plannerPersistedPayloadSchema.safeParse(row.plan_payload).success).toBe(true)
  })

  it('5.5-INT-06 regenerates a fingerprint-stable row that references a garment no longer eligible', async (context) => {
    if (!requireSchema(context)) return

    const { userId, locationId } = await arrangeUser('ineligible-garment')
    const anchorDate = computeAnchorDate('UTC')
    const targetDate = resolvePlannerDateWindow(anchorDate)[3]

    const first = await getPlanner(userId, locationId)
    expect(first.status).toBe(200)
    const firstRow = await findRow(userId, locationId, targetDate)
    const firstPayload = plannerPersistedPayloadSchema.parse(firstRow.plan_payload)

    // Corrupt only the stored payload -- dependency_fingerprint is left
    // exactly as-is, so the next read recomputes an IDENTICAL fingerprint
    // (nothing else about the user's inputs changed). This isolates
    // Decision 9's independent ownership re-check from fingerprint
    // invalidation: a stable fingerprint alone must not be enough to serve a
    // row naming an ineligible garment.
    const corrupted = {
      ...firstPayload,
      outfits: firstPayload.outfits.map((outfit, index) =>
        index === 0
          ? {
              ...outfit,
              garmentIds: [
                `${namespace}-nonexistent-garment`,
                ...outfit.garmentIds.slice(1),
              ],
            }
          : outfit
      ),
    }
    await prisma.plannerDayPlan.update({
      where: { id: firstRow.id },
      data: { plan_payload: corrupted },
    })

    const second = await getPlanner(userId, locationId)
    expect(second.status).toBe(200)
    const secondDay = (second.body as PlannerHttpResponse).data.days.find(
      (d) => d.planDate === targetDate
    )
    expect(secondDay?.status).toBe('ready')
    for (const outfit of secondDay?.outfits ?? []) {
      expect(outfit.garmentIds).not.toContain(`${namespace}-nonexistent-garment`)
    }

    const secondRow = await findRow(userId, locationId, targetDate)
    expect(secondRow.id).toBe(firstRow.id)
  })

  it('5.5-INT-07 rejects a stale reshuffle version with the real 409 and leaves the real row untouched', async (context) => {
    if (!requireSchema(context)) return

    const { userId, locationId } = await arrangeUser('reshuffle-conflict')
    const anchorDate = computeAnchorDate('UTC')
    const targetDate = resolvePlannerDateWindow(anchorDate)[1]

    const first = await getPlanner(userId, locationId)
    expect(first.status).toBe(200)

    const beforeRow = await findRow(userId, locationId, targetDate)
    expect(beforeRow.version).toBe(1)

    const response = await reshuffleDay(userId, targetDate, locationId, {
      expectedVersion: 999,
    })

    expect(response.status).toBe(409)
    expect(response.body).toMatchObject({ message: PLANNER_DAY_CHANGED_MESSAGE })

    const afterRow = await prisma.plannerDayPlan.findUniqueOrThrow({
      where: { id: beforeRow.id },
    })
    expect(afterRow.version).toBe(beforeRow.version)
    expect(afterRow.source).toBe(beforeRow.source)
    expect(afterRow.reshuffle_count).toBe(beforeRow.reshuffle_count)
    expect(afterRow.plan_payload).toEqual(beforeRow.plan_payload)
  })
})
